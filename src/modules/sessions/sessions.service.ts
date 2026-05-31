// ─── Sessions Service ─────────────────────────────────────────────────────────

import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TableSession, SessionDocument, SessionStatus } from './session.schema';
import { TablesService } from '../tables/tables.service';
import { BranchesService } from '../branches/branches.service';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';
import { Inject, forwardRef } from '@nestjs/common';
import * as crypto from 'crypto';

const SESSION_TTL_MINUTES = 30;

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(TableSession.name) private sessionModel: Model<SessionDocument>,
    private tablesService: TablesService,
    private branchesService: BranchesService,
    private notifications: NotificationsService,
  ) {}

  /**
   * QR scan entry point.
   * - Verifies the table belongs to the claimed branch (no cross-branch
   *   forgery via swapped query params).
   * - Verifies branch is active and QR ordering is enabled (respects the
   *   admin feature toggle + time window).
   * - Resumes active session if one exists.
   * - Blocks if bill is pending.
   * - Creates new session otherwise.
   */
  async getOrCreate(tableId: string, branchId: string, deviceId: string) {
    const table = await this.tablesService.findById(tableId);

    // Reject if the QR URL's branchId doesn't actually own the table.
    // Without this check, a customer (or attacker) could swap ?branch=...
    // to a different branch and spin up sessions in someone else's tenant.
    if ((table as any).branchId && (table as any).branchId !== branchId) {
      throw new ForbiddenException('Table does not belong to this branch.');
    }

    const qrOk = await this.branchesService.isQrOrderingEnabled(branchId);
    if (!qrOk) {
      throw new ForbiddenException(
        'QR ordering is currently unavailable. Please ask a server for assistance.',
      );
    }

    const existing = await this.sessionModel.findOne({
      tableId,
      status: SessionStatus.ACTIVE,
    });

    if (existing) {
      if (existing.billPending) {
        throw new ConflictException('Bill is pending. Please complete payment before placing new orders.');
      }
      const alreadyJoined = existing.participants.some((p) => p.deviceId === deviceId);
      if (!alreadyJoined) {
        existing.participants.push({ deviceId, joinedAt: new Date() });
        await existing.save();
      }
      return existing;
    }

    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
    return this.sessionModel.create({
      tableId,
      tableLabel: table.label,
      branchId,
      expiresAt,
      participants: [{ deviceId, joinedAt: new Date() }],
    });
  }

  async addOrder(sessionId: string, orderId: string) {
    const session = await this.sessionModel.findById(sessionId);
    if (!session) throw new NotFoundException('Session not found');
    if (!session.orderIds.includes(orderId)) {
      session.orderIds.push(orderId);
      await session.save();
    }
    return session;
  }

  async markBillPending(tableId: string) {
    await this.sessionModel.updateOne(
      { tableId, status: SessionStatus.ACTIVE },
      { billPending: true },
    );
  }

  async closeSession(tableId: string) {
    await this.sessionModel.updateOne(
      { tableId, status: SessionStatus.ACTIVE },
      { status: SessionStatus.CLOSED },
    );
  }

  async getActiveSession(tableId: string) {
    return this.sessionModel.findOne({ tableId, status: SessionStatus.ACTIVE }).lean();
  }

  /**
   * Customer-initiated "call a waiter" event. Fires a FCM push to every
   * waiter in the session's branch and appends an entry to the session's
   * helpRequests array so the waiter dashboard can show a pending inbox.
   *
   * Throttled at the controller level (public endpoint). We additionally
   * dedup here: if there's already an unresolved request in the last
   * minute, skip the push so a customer mashing the button doesn't blast
   * the whole waiter team.
   */
  async callWaiter(sessionId: string, reason?: string) {
    const session = await this.sessionModel.findById(sessionId);
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== SessionStatus.ACTIVE) {
      throw new ForbiddenException('Session is no longer active.');
    }

    const now = Date.now();
    const recent = session.helpRequests.find(
      (h) => !h.resolvedAt && now - new Date(h.at).getTime() < 60_000,
    );
    if (recent) {
      // Already pending — no-op so we don't fan out a second push.
      return { acknowledged: true, deduped: true };
    }

    const id = crypto.randomBytes(8).toString('hex');
    session.helpRequests.push({
      id,
      at: new Date(),
      reason: reason?.slice(0, 200),
    });
    await session.save();

    this.notifications.send(
      { roles: ['waiter'], branchId: session.branchId },
      {
        type: NotificationType.ORDER_READY, // reuses the high-priority "orders_ready" channel
        title: `Customer needs assistance — ${session.tableLabel}`,
        body: reason?.trim().length ? reason!.trim() : 'Help requested at table.',
        data: {
          sessionId: session._id.toString(),
          tableId: session.tableId,
          tableLabel: session.tableLabel,
          branchId: session.branchId,
          helpId: id,
          kind: 'CALL_WAITER',
        },
      },
    );

    return { acknowledged: true, helpId: id };
  }

  /** Branch waiter inbox — open help requests across every active session. */
  async listHelpRequests(branchId: string) {
    const sessions = await this.sessionModel
      .find({ branchId, status: SessionStatus.ACTIVE })
      .lean();
    const open: any[] = [];
    for (const s of sessions) {
      for (const h of s.helpRequests ?? []) {
        if (!h.resolvedAt) {
          open.push({
            sessionId: (s._id as any).toString(),
            tableId: s.tableId,
            tableLabel: s.tableLabel,
            helpId: h.id,
            at: h.at,
            reason: h.reason,
          });
        }
      }
    }
    open.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return open;
  }

  /** Waiter dismisses a help request after attending the table. */
  async resolveHelpRequest(sessionId: string, helpId: string, waiterId: string) {
    const session = await this.sessionModel.findById(sessionId);
    if (!session) throw new NotFoundException('Session not found');
    const entry = session.helpRequests.find((h) => h.id === helpId);
    if (!entry) throw new NotFoundException('Help request not found');
    if (entry.resolvedAt) return { resolved: true, alreadyResolved: true };
    entry.resolvedAt = new Date();
    entry.resolvedBy = waiterId;
    session.markModified('helpRequests');
    await session.save();
    return { resolved: true };
  }

  // Extend TTL on activity
  async refreshExpiry(sessionId: string) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
    await this.sessionModel.findByIdAndUpdate(sessionId, { expiresAt });
  }

  /**
   * Aggregate every order attached to this session into a running tab.
   * Public read — customer-facing on the QR screen. No PII beyond what
   * the customer already submitted via their own orders.
   */
  async getSessionBill(sessionId: string): Promise<{
    sessionId: string;
    tableLabel: string;
    branchId: string;
    status: string;
    billPending: boolean;
    orders: any[];
    subtotal: number;
    gstAmount: number;
    discountAmount: number;
    total: number;
  }> {
    const session = await this.sessionModel.findById(sessionId).lean();
    if (!session) throw new NotFoundException('Session not found');

    // Load orders by id — using the raw collection so we don't need to
    // import OrderModel here (would re-introduce a module dependency).
    const orderModel = (this.sessionModel.db as any).model('Order');
    const orders = await orderModel
      .find({ _id: { $in: session.orderIds.map((id: string) => id) } })
      .lean();

    const subtotal = orders.reduce((s: number, o: any) => s + (o.subtotal ?? 0), 0);
    const gstAmount = orders.reduce((s: number, o: any) => s + (o.gstAmount ?? 0), 0);
    const discountAmount = orders.reduce((s: number, o: any) => s + (o.discountAmount ?? 0), 0);
    const total = orders.reduce((s: number, o: any) => s + (o.total ?? 0), 0);

    return {
      sessionId: (session._id as any).toString(),
      tableLabel: session.tableLabel,
      branchId: session.branchId,
      status: session.status,
      billPending: session.billPending ?? false,
      orders: orders.map((o: any) => ({
        id: o._id,
        status: o.status,
        items: o.items,
        subtotal: o.subtotal,
        gstAmount: o.gstAmount,
        discountAmount: o.discountAmount,
        total: o.total,
        createdAt: o.createdAt,
      })),
      subtotal,
      gstAmount,
      discountAmount,
      total,
    };
  }
}
