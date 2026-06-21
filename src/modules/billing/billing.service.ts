import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bill, BillDocument, PaymentMethod } from './bill.schema';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '../orders/order.schema';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';
import { AuthUser, assertOwnsBranch, scopeFilter, roleOf } from '../../common/scope/branch-scope';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway/payment-gateway.interface';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/audit-log.schema';

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
    private ordersService: OrdersService,
    private notifications: NotificationsService,
    @Inject(PAYMENT_GATEWAY) private paymentGateway: PaymentGateway,
    private audit: AuditService,
  ) {}

  async generateBill(orderId: string, discountPercent = 0) {
    const existing = await this.billModel.findOne({ orderId: new Types.ObjectId(orderId) });
    if (existing) return existing;

    const order = await this.ordersService.getById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const subtotal = (order as any).subtotal ?? 0;
    const discountAmount = +(subtotal * (discountPercent / 100)).toFixed(2);
    const gstAmount = +((subtotal - discountAmount) * 0.18).toFixed(2);
    const total = +(subtotal - discountAmount + gstAmount).toFixed(2);

    return this.billModel.create({
      orderId: new Types.ObjectId(orderId),
      tableLabel: (order as any).tableLabel,
      // Stamp branchId so multi-tenant queries (including the FCM target
      // computation below) can filter without a join back to the order.
      branchId: (order as any).branchId,
      subtotal,
      discountAmount,
      discountPercent,
      gstAmount,
      total,
    });
  }

  async processPayment(
    billId: string,
    cashierId: string,
    paymentMethod: PaymentMethod,
    splitPayments?: { method: PaymentMethod; amount: number }[],
    idempotencyKey?: string,
    razorpay?: { razorpayPaymentId?: string; razorpayOrderId?: string },
    tipAmount?: number,
  ) {
    if (idempotencyKey) {
      const existing = await this.billModel.findOne({ _id: billId, processedKeys: idempotencyKey });
      if (existing) return existing;
    }

    const bill = await this.billModel.findById(billId);
    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.isPaid) throw new BadRequestException('Bill already paid');

    bill.isPaid = true;
    bill.paidAt = new Date();
    bill.cashierId = cashierId;
    bill.paymentMethod = paymentMethod;
    if (splitPayments?.length) bill.splitPayments = splitPayments as any;
    if (typeof tipAmount === 'number' && tipAmount > 0) {
      bill.tipAmount = tipAmount;
    }
    if (idempotencyKey) bill.processedKeys.push(idempotencyKey);
    if (razorpay?.razorpayPaymentId) {
      (bill as any).razorpayPaymentId = razorpay.razorpayPaymentId;
      // Refund handlers look up paymentChargeId to call Razorpay's refund
      // API. For Razorpay sandbox/live, the payment_id IS the chargeId on
      // the PSP side. Stamp it here so approveRefund/denyRefund don't
      // silently no-op on card/UPI bills.
      (bill as any).paymentChargeId = razorpay.razorpayPaymentId;
    }
    if (razorpay?.razorpayOrderId) {
      (bill as any).razorpayOrderId = razorpay.razorpayOrderId;
    }

    const saved = await bill.save();

    // Notify managers (and any admin) that the books moved. Branch-scoped
    // so a multi-branch operator only wakes up for their own takings.
    if ((saved as any).branchId) {
      this.notifications.send(
        { roles: ['manager', 'admin'], branchId: (saved as any).branchId },
        {
          type: NotificationType.PAYMENT_RECEIVED,
          title: 'Payment received',
          body: `${saved.tableLabel} — ₹${saved.total.toFixed(0)} via ${paymentMethod}`,
          data: {
            billId: saved._id.toString(),
            orderId: saved.orderId.toString(),
            tableLabel: saved.tableLabel,
            branchId: (saved as any).branchId,
            amount: saved.total.toString(),
            method: paymentMethod,
          },
        },
      );
    }

    return saved;
  }

  async findByOrder(orderId: string, scope?: AuthUser) {
    const bill = await this.billModel
      .findOne({ orderId: new Types.ObjectId(orderId) })
      .lean();
    if (bill && scope) assertOwnsBranch(scope, bill as any);
    return bill;
  }

  async findAll(isPaid?: boolean, scope?: AuthUser) {
    const sf = scope ? scopeFilter(scope) : {};
    const filter: any = { ...sf };
    if (isPaid !== undefined) filter.isPaid = isPaid;
    return this.billModel.find(filter).sort({ createdAt: -1 }).lean();
  }

  // ── Refund workflow ────────────────────────────────────────────────────────
  //
  // Three-step state machine:
  //   request → PENDING    (cashier|manager|admin) — captures reason
  //   approve → APPROVED   (manager|admin)         — fires the PSP refund and
  //                                                  stamps isRefunded
  //   deny    → DENIED     (manager|admin)         — closes the request out
  //
  // Branch-scoped throughout: a cashier can only request against their own
  // branch's bills, and a manager can only approve/deny within their branch.

  /**
   * Cashier (or manager/admin) flags a paid bill for refund. Records the
   * reason and optional reference (e.g. a customer complaint ticket id) and
   * pushes the request to manager+admin for approval.
   */
  async requestRefund(
    billId: string,
    user: AuthUser,
    reason: string,
    reference?: string,
  ) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Refund reason is required');
    }
    const bill = await this.billModel.findById(billId);
    if (!bill) throw new NotFoundException('Bill not found');
    assertOwnsBranch(user, bill as any);
    if (!bill.isPaid) throw new BadRequestException('Bill is not paid');
    if ((bill as any).isRefunded) throw new BadRequestException('Already refunded');
    if ((bill as any).refundStatus === 'PENDING') {
      throw new BadRequestException('Refund already requested');
    }
    if ((bill as any).refundStatus === 'APPROVED') {
      throw new BadRequestException('Refund already approved');
    }

    (bill as any).refundStatus = 'PENDING';
    (bill as any).refundReason = reason.trim();
    if (reference) (bill as any).refundReference = reference.trim();
    (bill as any).refundRequestedBy = user._id?.toString?.() ?? String(user._id);
    (bill as any).refundRequestedAt = new Date();
    // Clear any previous denial so the request restarts cleanly.
    (bill as any).refundDeniedBy = undefined;
    (bill as any).refundResolvedAt = undefined;

    const saved = await bill.save();

    if ((saved as any).branchId) {
      this.notifications.send(
        { roles: ['manager', 'admin'], branchId: (saved as any).branchId },
        {
          type: NotificationType.REFUND_REQUESTED,
          title: 'Refund requested',
          body: `${saved.tableLabel} — ₹${saved.total.toFixed(0)} • ${reason.trim()}`,
          data: {
            billId: saved._id.toString(),
            orderId: saved.orderId.toString(),
            tableLabel: saved.tableLabel,
            branchId: (saved as any).branchId,
            amount: saved.total.toString(),
            reason: reason.trim(),
            requestedBy: roleOf(user),
          },
        },
      );
    }

    return saved;
  }

  /**
   * Manager (or admin) approves a PENDING refund. Fires the PSP refund and,
   * on success, stamps the bill as refunded. We DO NOT mark the bill as
   * refunded if the PSP call fails — that would orphan the money on the
   * customer's card. Mirrors AdminService.processRefund but operates inside
   * the request/approve/deny state machine.
   */
  async approveRefund(billId: string, user: AuthUser) {
    const bill = await this.billModel.findById(billId);
    if (!bill) throw new NotFoundException('Bill not found');
    assertOwnsBranch(user, bill as any);
    if (!bill.isPaid) throw new BadRequestException('Bill is not paid');
    if ((bill as any).isRefunded) throw new BadRequestException('Already refunded');
    if ((bill as any).refundStatus !== 'PENDING') {
      throw new BadRequestException('No pending refund request to approve');
    }

    const chargeId = (bill as any).paymentChargeId ?? '';
    const psp = await this.paymentGateway.refund(
      chargeId,
      bill.total,
      `Bill ${bill._id.toString()} refund approved by ${user._id}`,
    );

    (bill as any).isRefunded = true;
    (bill as any).refundedAt = new Date();
    (bill as any).refundedBy = user._id?.toString?.() ?? String(user._id);
    (bill as any).refundId = psp.refundId;
    (bill as any).refundProvider = psp.provider;
    (bill as any).refundProviderStatus = psp.status;
    (bill as any).refundStatus = 'APPROVED';
    (bill as any).refundApprovedBy = user._id?.toString?.() ?? String(user._id);
    (bill as any).refundResolvedAt = new Date();

    const saved = await bill.save();
    // Compliance trail — without this entry, two-step refunds were
    // invisible in the audit log even though admin-initiated ones were
    // recorded. Manager refunds carry the highest authorization weight,
    // so they MUST land in the audit.
    this.audit.record({
      type: AuditEventType.BILL_REFUNDED,
      actorId: user._id?.toString?.() ?? String(user._id),
      actorRole: roleOf(user),
      branchId: (bill as any).branchId,
      meta: {
        billId: bill._id.toString(),
        amount: bill.total,
        chargeId,
        refundId: psp.refundId,
        outcome: 'APPROVED',
        reason: (bill as any).refundReason,
      },
    }).catch(() => {});
    return saved;
  }

  /**
   * Manager (or admin) denies a PENDING refund. Records who denied and when;
   * does NOT touch the PSP or isRefunded so the bill stays paid.
   */
  async denyRefund(billId: string, user: AuthUser) {
    const bill = await this.billModel.findById(billId);
    if (!bill) throw new NotFoundException('Bill not found');
    assertOwnsBranch(user, bill as any);
    if ((bill as any).refundStatus !== 'PENDING') {
      throw new BadRequestException('No pending refund request to deny');
    }

    (bill as any).refundStatus = 'DENIED';
    (bill as any).refundDeniedBy = user._id?.toString?.() ?? String(user._id);
    (bill as any).refundResolvedAt = new Date();

    const saved = await bill.save();
    this.audit.record({
      type: AuditEventType.BILL_REFUNDED,
      actorId: user._id?.toString?.() ?? String(user._id),
      actorRole: roleOf(user),
      branchId: (bill as any).branchId,
      meta: {
        billId: bill._id.toString(),
        amount: bill.total,
        outcome: 'DENIED',
        reason: (bill as any).refundReason,
      },
    }).catch(() => {});
    return saved;
  }

  async getDailyRevenue(scope?: AuthUser) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const sf = scope ? scopeFilter(scope) : {};
    const result = await this.billModel.aggregate([
      { $match: { ...sf, isPaid: true, paidAt: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);
    return result[0] ?? { total: 0, count: 0 };
  }

  /**
   * GST / tax CSV export. Walks paid bills in the [from, to] window,
   * branch-scoped so a manager only exports their own branch's takings.
   *
   * Output columns line up with what most India-side accountants want for
   * a GSTR-3B reconciliation — bill ref, paid timestamp (ISO 8601 so
   * Excel/Sheets won't mangle DD/MM), subtotal, discount, GST collected,
   * total, payment method, branchId.
   */
  async generateGstCsv(from: Date, to: Date, scope?: AuthUser): Promise<string> {
    const sf = scope ? scopeFilter(scope) : {};
    const bills = await this.billModel
      .find({
        ...sf,
        isPaid: true,
        paidAt: { $gte: from, $lte: to },
      })
      .sort({ paidAt: 1 })
      .lean();

    const header =
      'billId,paidAt,subtotal,discountAmount,gstAmount,total,paymentMethod,branchId';
    const escape = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Quote anything containing comma, quote, or newline; double up quotes.
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = bills.map((b: any) => {
      const paidAt = b.paidAt ? new Date(b.paidAt).toISOString() : '';
      return [
        b._id?.toString() ?? '',
        paidAt,
        (b.subtotal ?? 0).toFixed(2),
        (b.discountAmount ?? 0).toFixed(2),
        (b.gstAmount ?? 0).toFixed(2),
        (b.total ?? 0).toFixed(2),
        b.paymentMethod ?? '',
        b.branchId ?? '',
      ]
        .map(escape)
        .join(',');
    });

    return [header, ...rows].join('\n') + '\n';
  }
}
