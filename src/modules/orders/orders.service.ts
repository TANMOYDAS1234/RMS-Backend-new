// ─── Orders Service ──────────────────────────────────────────────────────────

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from './order.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { OrdersGateway } from '../../gateways/orders.gateway';
import { TablesService } from '../tables/tables.service';
import { BranchesService } from '../branches/branches.service';
import { SessionsService } from '../sessions/sessions.service';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';
import {
  AuthUser,
  assertOwnsBranch,
  scopeFilter,
} from '../../common/scope/branch-scope';

// Valid state machine transitions
const TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.CREATED]: [OrderStatus.CONFIRMED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
  [OrderStatus.READY]: [OrderStatus.SERVED],
  [OrderStatus.SERVED]: [OrderStatus.BILLED],
  [OrderStatus.BILLED]: [OrderStatus.PAID],
  [OrderStatus.PAID]: [OrderStatus.CLOSED],
};

const DEFAULT_GST_RATE = 0.18; // fallback if a branch hasn't configured one

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private readonly gateway: OrdersGateway,
    private readonly tablesService: TablesService,
    private readonly branchesService: BranchesService,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Compute subtotal + GST + total using the branch's configured rate. */
  private async _price(items: CreateOrderDto['items'], branchId: string) {
    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    let gstRate = DEFAULT_GST_RATE;
    try {
      const branch = await this.branchesService.findById(branchId);
      gstRate = (branch as any).gstRate ?? DEFAULT_GST_RATE;
    } catch (_) {
      // branch missing → fall back to default; don't block the order.
    }
    const gstAmount = +(subtotal * gstRate).toFixed(2);
    const total = +(subtotal + gstAmount).toFixed(2);
    return { subtotal, gstAmount, total };
  }

  /**
   * Staff-initiated create. Derives branchId from the table (the table is
   * branch-scoped) and asserts the caller is allowed to write to that branch.
   */
  async createForStaff(
    dto: CreateOrderDto,
    user: AuthUser,
    idempotencyKey: string,
  ): Promise<Order> {
    const existing = await this.orderModel.findOne({ processedKeys: idempotencyKey });
    if (existing) return existing;

    const table = await this.tablesService.findById(dto.tableId);
    const branchId = (table as any).branchId as string;
    if (!branchId) {
      throw new BadRequestException('Table is not assigned to a branch.');
    }
    assertOwnsBranch(user, { branchId } as any);

    const { subtotal, gstAmount, total } = await this._price(dto.items, branchId);
    const order = await this.orderModel.create({
      tableId: dto.tableId,
      tableLabel: dto.tableLabel,
      items: dto.items,
      notes: dto.notes,
      branchId,
      waiterId: (user as any)._id?.toString?.() ?? (user as any).id ?? undefined,
      subtotal,
      gstAmount,
      total,
      processedKeys: [idempotencyKey],
      auditLog: [{ action: 'CREATED', by: (user as any)._id ?? 'system', at: new Date() }],
    });

    this.gateway.emitOrderCreated(order);
    this._notifyOrderCreated(order, dto.tableLabel, branchId);
    return order;
  }

  /**
   * Public/QR create. The session is the trust anchor — it tells us the
   * tableId and branchId, so a malicious body can't smuggle a different
   * table or branch in. We also check the session isn't bill-pending or
   * expired.
   */
  async createFromSession(dto: CreateOrderDto, idempotencyKey: string): Promise<Order> {
    if (!dto.sessionId) throw new BadRequestException('sessionId is required');

    const existing = await this.orderModel.findOne({ processedKeys: idempotencyKey });
    if (existing) return existing;

    // Session lookup (the service throws if missing).
    const session: any = await (this.sessionsService as any).sessionModel.findById(dto.sessionId);
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'active') {
      throw new ForbiddenException('Session is closed.');
    }
    if (session.billPending) {
      throw new ConflictException(
        'Bill is pending. Please complete payment before placing new orders.',
      );
    }
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      throw new ForbiddenException('Session has expired. Please rescan the QR.');
    }

    // The QR feature toggle could have been turned off between the scan
    // and the order. Re-check before committing the write.
    const qrOk = await this.branchesService.isQrOrderingEnabled(session.branchId);
    if (!qrOk) {
      throw new ForbiddenException('QR ordering is currently unavailable.');
    }

    const { subtotal, gstAmount, total } = await this._price(dto.items, session.branchId);
    const order = await this.orderModel.create({
      tableId: session.tableId,
      tableLabel: session.tableLabel,
      items: dto.items,
      notes: dto.notes,
      branchId: session.branchId,
      // Public orders have no waiter on creation; staff claims it later.
      subtotal,
      gstAmount,
      total,
      processedKeys: [idempotencyKey],
      auditLog: [{ action: 'CREATED_QR', by: 'customer', at: new Date(), meta: { sessionId: session._id.toString() } }],
    });

    // Link order back to session so the bill endpoint can aggregate.
    await this.sessionsService.addOrder(session._id.toString(), order._id.toString());

    this.gateway.emitOrderCreated(order);
    this._notifyOrderCreated(order, session.tableLabel, session.branchId);
    return order;
  }

  /** Push notify chefs in the order's branch that a new order arrived. */
  private _notifyOrderCreated(order: any, tableLabel: string, branchId: string) {
    this.notifications.send(
      { roles: ['chef'], branchId },
      {
        type: NotificationType.ORDER_CREATED,
        title: 'New order',
        body: `${tableLabel} — ${order.items?.length ?? 0} item(s)`,
        data: {
          orderId: order._id.toString(),
          tableId: order.tableId,
          tableLabel,
          branchId,
        },
      },
    );
  }

  async getActiveOrders(user?: AuthUser): Promise<Order[]> {
    const sf = user ? scopeFilter(user) : {};
    return this.orderModel
      .find({
        ...sf,
        status: { $nin: [OrderStatus.PAID, OrderStatus.CLOSED] },
      })
      .sort({ createdAt: -1 })
      .lean();
  }

  async getById(id: string): Promise<Order> {
    const order = await this.orderModel.findById(id).lean();
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async updateStatus(
    id: string,
    dto: UpdateStatusDto,
    userId: string,
    idempotencyKey: string,
  ): Promise<Order> {
    // Idempotency — already processed?
    const existing = await this.orderModel.findOne({
      _id: id,
      processedKeys: idempotencyKey,
    });
    if (existing) return existing;

    // Use MongoDB transaction for consistency
    const session: ClientSession = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      const order = await this.orderModel
        .findById(id)
        .session(session);

      if (!order) throw new NotFoundException(`Order ${id} not found`);

      // Optimistic locking check
      if (order.version !== dto.version) {
        throw new ConflictException({
          message: 'Version conflict. Order was modified by another user.',
          serverVersion: order.version,
          serverStatus: order.status,
        });
      }

      // State machine validation
      const allowed = TRANSITIONS[order.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from ${order.status} to ${dto.status}`,
        );
      }

      order.status = dto.status;
      order.processedKeys.push(idempotencyKey);
      order.auditLog.push({ action: `STATUS_${dto.status.toUpperCase()}`, by: userId, at: new Date() });

      await order.save({ session });
      await session.commitTransaction();

      this.gateway.emitOrderUpdated(order);
      this._notifyStatusTransition(order);
      return order;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Route a state-change to the role that needs to act next. READY → waiter
   * goes to pick up; SERVED → cashier prepares the bill. The branch scope
   * comes from the order itself so a busy multi-branch operator's chefs in
   * one location don't get woken up by another location's prep.
   */
  private _notifyStatusTransition(order: any) {
    const branchId = order.branchId;
    if (!branchId) return;
    if (order.status === OrderStatus.READY) {
      this.notifications.send(
        { roles: ['waiter'], branchId },
        {
          type: NotificationType.ORDER_READY,
          title: 'Order ready to serve',
          body: `${order.tableLabel} — ${order.items?.length ?? 0} item(s)`,
          data: {
            orderId: order._id.toString(),
            tableId: order.tableId,
            tableLabel: order.tableLabel,
            branchId,
          },
        },
      );
    } else if (order.status === OrderStatus.SERVED) {
      this.notifications.send(
        { roles: ['cashier'], branchId },
        {
          type: NotificationType.ORDER_SERVED,
          title: 'Order served — ready to bill',
          body: `${order.tableLabel} — ₹${(order.total ?? 0).toFixed(0)}`,
          data: {
            orderId: order._id.toString(),
            tableId: order.tableId,
            tableLabel: order.tableLabel,
            branchId,
          },
        },
      );
    }
  }

  async updateItemProgress(
    orderId: string,
    itemId: string,
    progress: number,
    userId: string,
  ): Promise<void> {
    await this.orderModel.updateOne(
      { _id: orderId, 'items.itemId': itemId },
      { $set: { 'items.$.progress': progress } },
    );
    this.gateway.emitKitchenProgress({ orderId, itemId, progress });
  }
}
