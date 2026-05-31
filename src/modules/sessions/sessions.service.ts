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
   * QR scan entry point — multi-party aware.
   *
   * Flow:
   *  1. Validate branch ownership of the table + QR feature gate.
   *  2. Resume: if any active session on this table already has this
   *     deviceId in its participants, return that session unchanged.
   *  3. New party path: needs `partySize`. If the caller didn't supply
   *     one, return a `needsPartySize` envelope with current capacity
   *     info so the customer app can show "How many of you?".
   *  4. Capacity check: sum(activeSessions.partySize) + requested ≤
   *     table.capacity. Reject the new party if it would oversell.
   *  5. Create a fresh session with the next sequential partyLabel
   *     ("A", "B", "C", …). Resets implicitly once all parties leave.
   *
   * billPending blocks new parties from joining the *same* session, but
   * a different party (different deviceId) is fine — their own session
   * isn't billed yet.
   */
  async getOrCreate(
    tableId: string,
    branchId: string,
    deviceId: string,
    partySize?: number,
  ): Promise<any> {
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

    const activeSessions = await this.sessionModel.find({
      tableId,
      status: SessionStatus.ACTIVE,
    });

    // 1. Resume — device already participates in some party here.
    const own = activeSessions.find((s) =>
      s.participants.some((p) => p.deviceId === deviceId),
    );
    if (own) {
      if (own.billPending) {
        throw new ConflictException(
          'Bill is pending. Please complete payment before placing new orders.',
        );
      }
      return own;
    }

    const capacity = (table as any).capacity ?? 1;
    const occupied = activeSessions.reduce(
      (s, x) => s + (x.partySize ?? 1),
      0,
    );
    const remaining = Math.max(0, capacity - occupied);

    // 2. No party size yet — tell the client to ask.
    if (partySize == null || partySize <= 0) {
      return {
        needsPartySize: true,
        tableId,
        tableLabel: table.label,
        branchId,
        capacity,
        occupied,
        remaining,
        activeParties: activeSessions.map((s) => ({
          partyLabel: s.partyLabel || '?',
          partySize: s.partySize ?? 1,
        })),
      };
    }

    // 3. Capacity check — refuse to oversell.
    if (partySize > remaining) {
      throw new ConflictException(
        remaining === 0
          ? 'This table is full. Please ask a server for another table.'
          : `Only ${remaining} seat${remaining === 1 ? '' : 's'} free at this table.`,
      );
    }

    // 4. Assign the next free party label (A → B → C …). Cap at "Z"; once
    // we wrap around we fall back to the empty string and clients render
    // "Party (party#)" off the index.
    const usedLabels = new Set(activeSessions.map((s) => s.partyLabel));
    const nextLabel =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !usedLabels.has(c)) ?? '';

    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
    return this.sessionModel.create({
      tableId,
      tableLabel: table.label,
      branchId,
      expiresAt,
      partySize,
      partyLabel: nextLabel,
      participants: [{ deviceId, joinedAt: new Date() }],
    });
  }

  /**
   * Read-only capacity view. Used by the customer app to render
   * "Joining a busy table — 2 free seats" before showing the
   * party-size picker, and by the floor grid to render N parties per
   * table.
   */
  async getCapacity(tableId: string) {
    const table = await this.tablesService.findById(tableId);
    const activeSessions = await this.sessionModel
      .find({ tableId, status: SessionStatus.ACTIVE })
      .lean();
    const capacity = (table as any).capacity ?? 1;
    const occupied = activeSessions.reduce(
      (s, x) => s + (x.partySize ?? 1),
      0,
    );
    return {
      tableId,
      tableLabel: table.label,
      capacity,
      occupied,
      remaining: Math.max(0, capacity - occupied),
      activeParties: activeSessions.map((s) => ({
        sessionId: (s._id as any).toString(),
        partyLabel: s.partyLabel || '',
        partySize: s.partySize ?? 1,
        billPending: s.billPending ?? false,
      })),
    };
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

  /** Mark a specific party's bill pending. Doesn't affect other parties
   * sitting at the same physical table. */
  async markBillPending(sessionId: string) {
    await this.sessionModel.updateOne(
      { _id: sessionId, status: SessionStatus.ACTIVE },
      { billPending: true },
    );
  }

  /** Close a specific party. Other parties at the same table remain
   * active. The customer's QR for that party stops accepting new orders. */
  async closeSession(sessionId: string) {
    await this.sessionModel.updateOne(
      { _id: sessionId, status: SessionStatus.ACTIVE },
      { status: SessionStatus.CLOSED },
    );
  }

  /** Backward-compat singular getter: returns ANY active session at the
   * table (the first one found). Callers that need every party should
   * use `getActiveSessionsForTable` or `getCapacity` instead. */
  async getActiveSession(tableId: string) {
    return this.sessionModel
      .findOne({ tableId, status: SessionStatus.ACTIVE })
      .lean();
  }

  /** Every active party at this table. Used by the floor grid to render
   * sub-cards per party. */
  async getActiveSessionsForTable(tableId: string) {
    return this.sessionModel
      .find({ tableId, status: SessionStatus.ACTIVE })
      .lean();
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
