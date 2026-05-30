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

const SESSION_TTL_MINUTES = 30;

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(TableSession.name) private sessionModel: Model<SessionDocument>,
    private tablesService: TablesService,
    private branchesService: BranchesService,
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
