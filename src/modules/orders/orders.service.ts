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
  roleOf,
  scopeFilter,
} from '../../common/scope/branch-scope';

// Valid state machine transitions
const TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  // CREATED and CONFIRMED can also CANCEL (customer/manager flow). After
  // the kitchen starts work (PREPARING) cancellation requires a staff
  // refund instead, so we don't allow the customer-cancel jump.
  [OrderStatus.CREATED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
  [OrderStatus.READY]: [OrderStatus.SERVED],
  [OrderStatus.SERVED]: [OrderStatus.BILLED],
  [OrderStatus.BILLED]: [OrderStatus.PAID],
  [OrderStatus.PAID]: [OrderStatus.CLOSED],
};

// Role → which transitions a user of that role is allowed to PERFORM.
// Without this gate, a cashier could mark an order PREPARING and a chef
// could mark it PAID — only branch scope was checked. admin + manager
// are deliberately omitted so they can perform any transition (they're
// the override authority).
const ROLE_TRANSITIONS: Record<string, OrderStatus[]> = {
  waiter: [OrderStatus.CONFIRMED, OrderStatus.SERVED, OrderStatus.BILLED],
  chef: [OrderStatus.PREPARING, OrderStatus.READY],
  cashier: [OrderStatus.BILLED, OrderStatus.PAID, OrderStatus.CLOSED],
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

  /**
   * Customer self-cancel. Authenticated by sessionId — only orders linked
   * to the same session can be cancelled, and only while the kitchen
   * hasn't started cooking (status in CREATED|CONFIRMED). Public route
   * (no JWT) because customers don't sign in.
   */
  async cancelByCustomer(orderId: string, sessionId: string, idempotencyKey: string): Promise<Order> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    // Verify the order belongs to this session — without this check any
    // anonymous caller could cancel any order by ID.
    const session: any = await (this.sessionsService as any).sessionModel.findById(sessionId);
    if (!session) throw new NotFoundException('Session not found');
    const ownsOrder = (session.orderIds ?? []).some(
      (oid: any) => oid?.toString?.() === orderId,
    );
    if (!ownsOrder) {
      throw new ForbiddenException('This order does not belong to your session.');
    }
    if (order.status !== OrderStatus.CREATED && order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException(
        'Cannot cancel — the kitchen has already started preparing your order. Please ask a server.',
      );
    }
    // Idempotency: same key + same order = no-op.
    if (order.processedKeys.includes(idempotencyKey)) return order.toObject();
    order.status = OrderStatus.CANCELLED;
    order.processedKeys.push(idempotencyKey);
    order.auditLog.push({ action: 'STATUS_CANCELLED_BY_CUSTOMER', by: 'customer', at: new Date() });
    const saved = await order.save();
    this.gateway.emitOrderUpdated(saved);
    return saved;
  }

  async getById(id: string, scope?: AuthUser): Promise<Order> {
    const order = await this.orderModel.findById(id).lean();
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    // Block cross-branch reads. Admin (scopeFilter is {}) passes through;
    // anyone else without the matching branchId hits the ForbiddenException
    // helper. Undefined scope falls through to support internal callers.
    if (scope) assertOwnsBranch(scope, order as any);
    return order;
  }

  async updateStatus(
    id: string,
    dto: UpdateStatusDto,
    scope: AuthUser,
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

      // Branch ownership: a manager/waiter from branch B cannot mutate a
      // branch-A order's status. Admin passes through.
      assertOwnsBranch(scope, order as any);

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

      // Role gate: a cashier should never mark an order PREPARING; a
      // chef should never mark it PAID. Admin + manager bypass — they're
      // the override authority for any state. Without this check the
      // backend trusted the role-guarded controller route entirely, but
      // the same /orders/:id/status endpoint is open to every operator
      // role for legitimate transitions of their own.
      const role = roleOf(scope);
      if (role !== 'admin' && role !== 'manager') {
        const roleAllowed = ROLE_TRANSITIONS[role] ?? [];
        if (!roleAllowed.includes(dto.status)) {
          throw new ForbiddenException(
            `Your role (${role}) is not allowed to advance an order to ${dto.status}.`,
          );
        }
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

  /**
   * Replace the items list on an in-flight order. Used by the waiter
   * "amend order" flow. Allowed before the kitchen starts (CREATED or
   * CONFIRMED). Once status is PREPARING+ the kitchen is invested in
   * the existing items — desk-side edits at that point cause
   * double-cooks or wasted food. Optimistic lock via `version` (same as
   * updateStatus) catches concurrent edits.
   */
  async amendItems(
    id: string,
    body: {
      items: { itemId: string; name: string; quantity: number; unitPrice: number; notes?: string }[];
      version: number;
      notes?: string;
    },
    user: AuthUser,
    idempotencyKey: string,
  ): Promise<Order> {
    if (!body.items?.length) {
      throw new BadRequestException('At least one item is required.');
    }
    const existing = await this.orderModel.findOne({ _id: id, processedKeys: idempotencyKey });
    if (existing) return existing;

    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    assertOwnsBranch(user, order as any);

    if (order.version !== body.version) {
      throw new ConflictException({
        message: 'Version conflict. Refresh and try again.',
        serverVersion: order.version,
        serverStatus: order.status,
      });
    }
    if (![OrderStatus.CREATED, OrderStatus.CONFIRMED].includes(order.status)) {
      throw new BadRequestException(
        `Cannot amend items once order is ${order.status}.`,
      );
    }

    const { subtotal, gstAmount, total } = await this._price(body.items, (order as any).branchId);
    order.items = body.items as any;
    if (body.notes !== undefined) order.notes = body.notes;
    order.subtotal = subtotal;
    order.gstAmount = gstAmount;
    order.total = total;
    order.processedKeys.push(idempotencyKey);
    order.auditLog.push({
      action: 'ITEMS_AMENDED',
      by: (user as any)._id?.toString?.() ?? 'unknown',
      at: new Date(),
      meta: { newItemCount: body.items.length, newTotal: total },
    });
    await order.save();
    this.gateway.emitOrderUpdated(order);
    return order;
  }

  async updateItemProgress(
    orderId: string,
    itemId: string,
    progress: number,
    userId: string,
    scope?: AuthUser,
    idempotencyKey?: string,
  ): Promise<void> {
    // Branch ownership + load the order so we can route the WS event
    // to the right rooms (chef cohort of the order's branch, plus the
    // customer's table) instead of broadcasting globally.
    const order = await this.orderModel.findById(orderId).lean();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (scope) assertOwnsBranch(scope, order as any);
    // True idempotency: if the chef's slider sends the same key twice
    // (network retry, double-click), the second write is a no-op
    // instead of risking out-of-order last-write-wins overwrites of a
    // newer value. The controller demands a key on every PATCH so we
    // can assume it's present.
    if (idempotencyKey && (order as any).processedKeys?.includes(idempotencyKey)) {
      return;
    }
    await this.orderModel.updateOne(
      { _id: orderId, 'items.itemId': itemId },
      {
        $set: { 'items.$.progress': progress },
        ...(idempotencyKey
          ? { $addToSet: { processedKeys: idempotencyKey } }
          : {}),
      },
    );
    this.gateway.emitKitchenProgress({
      orderId,
      itemId,
      progress,
      branchId: (order as any).branchId,
      tableId: (order as any).tableId,
    });
  }
}
