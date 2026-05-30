// ─── Notifications Service ───────────────────────────────────────────────────
//
// One place that knows how to:
//   1. Register a device token for a user (upsert on userId+deviceId).
//   2. Query "every active token for users with role X in branch Y".
//   3. POST those tokens to FCM HTTP v1 with the right channelId / data
//      payload so the Flutter background handler can route to the right
//      screen.
//
// HTTP v1 is implemented inline (no firebase-admin dependency) so this also
// works on Render free tier without juggling a service-account JSON file —
// the same shape we already use in inventory.service.ts, generalized.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import * as https from 'https';
import { FcmToken, FcmTokenDocument, DevicePlatform } from './fcm-token.schema';

/**
 * Discrete notification types. The Flutter background handler routes on
 * `data.type` to decide which screen to open.
 */
export enum NotificationType {
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_READY = 'ORDER_READY',
  ORDER_SERVED = 'ORDER_SERVED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  LOW_STOCK = 'LOW_STOCK',
}

/** Per-type channel ids — match the Flutter AndroidNotificationChannel defs. */
const CHANNEL_FOR: Record<NotificationType, string> = {
  [NotificationType.ORDER_CREATED]: 'orders_new',
  [NotificationType.ORDER_READY]: 'orders_ready',
  [NotificationType.ORDER_SERVED]: 'orders_served',
  [NotificationType.PAYMENT_RECEIVED]: 'payments',
  [NotificationType.LOW_STOCK]: 'low_stock',
};

export interface RecipientFilter {
  /** Match users with any of these roles. */
  roles?: string[];
  /** Restrict to this branch. Admin push usually omits this. */
  branchId?: string;
  /** Match a specific user (e.g. notify the waiter who took the order). */
  userId?: string;
}

export interface PushPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Arbitrary extra fields routed to the client's data payload. */
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  private _accessToken: string | null = null;
  private _accessTokenExpiresAt = 0;

  constructor(
    @InjectModel(FcmToken.name) private tokenModel: Model<FcmTokenDocument>,
    private config: ConfigService,
  ) {}

  // ── Registration ───────────────────────────────────────────────────────────

  /**
   * Upsert (userId, deviceId) → token. Called when a client app starts up
   * and grabs a fresh FCM token, or when it rotates.
   *
   * `branchId` and `role` are denormalized so the recipient query stays a
   * single round-trip.
   */
  async register(input: {
    userId: string;
    deviceId: string;
    token: string;
    platform?: DevicePlatform;
    branchId?: string | null;
    role?: string;
  }) {
    await this.tokenModel.updateOne(
      { userId: input.userId, deviceId: input.deviceId },
      {
        $set: {
          token: input.token,
          platform: input.platform ?? DevicePlatform.ANDROID,
          branchId: input.branchId ?? undefined,
          role: input.role,
          lastSeenAt: new Date(),
          isActive: true,
        },
      },
      { upsert: true },
    );
  }

  /**
   * Deactivate every token for a user. Called on logout so the next user
   * to log into the device doesn't keep getting the previous user's pushes.
   */
  async clearForUser(userId: string) {
    await this.tokenModel.updateMany(
      { userId },
      { $set: { isActive: false, lastSeenAt: new Date() } },
    );
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  /**
   * Resolve recipients via the FcmToken collection and send the same payload
   * to every matching active token. Failures are logged but never thrown —
   * a flaky FCM run must not break the user-facing mutation that called us.
   */
  async send(filter: RecipientFilter, payload: PushPayload): Promise<void> {
    try {
      const tokens = await this._collectTokens(filter);
      if (!tokens.length) return;
      await this._fanOut(tokens, payload);
    } catch (err) {
      this.log.warn(
        `FCM send failed (${payload.type}): ${(err as Error).message}`,
      );
    }
  }

  private async _collectTokens(filter: RecipientFilter): Promise<string[]> {
    const q: any = { isActive: true };
    if (filter.userId) q.userId = filter.userId;
    if (filter.roles?.length) q.role = { $in: filter.roles };
    if (filter.branchId) {
      // Admin tokens (no branchId) should still be included for branch-
      // scoped events so they can monitor — match either same-branch OR
      // role:admin (unbranched).
      q.$or = [{ branchId: filter.branchId }, { role: 'admin' }];
    }
    const rows = await this.tokenModel.find(q).select('token').lean();
    // Dedup defensively — same physical token shouldn't appear twice but
    // sometimes legacy data has dupes.
    return Array.from(new Set(rows.map((r) => r.token).filter(Boolean)));
  }

  private async _fanOut(tokens: string[], payload: PushPayload) {
    const projectId = this.config.get<string>('FCM_PROJECT_ID');
    const serviceAccountKey = this.config.get<string>(
      'FCM_SERVICE_ACCOUNT_KEY',
    );
    if (!projectId || !serviceAccountKey) {
      this.log.debug('FCM creds missing — push disabled');
      return;
    }
    const accessToken = await this._getAccessToken(serviceAccountKey);
    if (!accessToken) return;

    const channelId = CHANNEL_FOR[payload.type];
    const data: Record<string, string> = {
      type: payload.type,
      ...(payload.data ?? {}),
    };

    await Promise.allSettled(
      tokens.map((token) =>
        this._postFcmMessage(projectId, accessToken, {
          token,
          notification: { title: payload.title, body: payload.body },
          data,
          android: {
            priority: 'high',
            notification: { channelId, sound: 'default' },
          },
          apns: { payload: { aps: { sound: 'default', badge: 1 } } },
        }),
      ),
    );
  }

  // ── OAuth2 access-token cache ──────────────────────────────────────────────

  private async _getAccessToken(serviceAccountKeyJson: string): Promise<string | null> {
    const nowSec = Math.floor(Date.now() / 1000);
    if (this._accessToken && this._accessTokenExpiresAt > nowSec + 30) {
      return this._accessToken;
    }
    const fresh = await this._mintAccessToken(serviceAccountKeyJson);
    if (fresh) {
      this._accessToken = fresh;
      this._accessTokenExpiresAt = nowSec + 3500;
    }
    return fresh;
  }

  private _mintAccessToken(serviceAccountKeyJson: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const key = JSON.parse(serviceAccountKeyJson);
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(
          JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
        ).toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({
            iss: key.client_email,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
          }),
        ).toString('base64url');
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(`${header}.${payload}`);
        const sig = sign.sign(key.private_key, 'base64url');
        const jwt = `${header}.${payload}.${sig}`;
        const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
        const req = https.request(
          {
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': postData.length,
            },
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              try {
                resolve(JSON.parse(data).access_token ?? null);
              } catch {
                resolve(null);
              }
            });
          },
        );
        req.on('error', () => resolve(null));
        req.write(postData);
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  private _postFcmMessage(
    projectId: string,
    accessToken: string,
    message: object,
  ): Promise<void> {
    return new Promise((resolve) => {
      const body = JSON.stringify({ message });
      const req = https.request(
        {
          hostname: 'fcm.googleapis.com',
          path: `/v1/projects/${projectId}/messages:send`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        () => resolve(),
      );
      req.on('error', () => resolve());
      req.write(body);
      req.end();
    });
  }
}
