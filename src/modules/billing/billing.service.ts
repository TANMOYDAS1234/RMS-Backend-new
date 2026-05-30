import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bill, BillDocument, PaymentMethod } from './bill.schema';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '../orders/order.schema';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
    private ordersService: OrdersService,
    private notifications: NotificationsService,
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
    if (idempotencyKey) bill.processedKeys.push(idempotencyKey);
    if (razorpay?.razorpayPaymentId) {
      (bill as any).razorpayPaymentId = razorpay.razorpayPaymentId;
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

  async findByOrder(orderId: string) {
    return this.billModel.findOne({ orderId: new Types.ObjectId(orderId) }).lean();
  }

  async findAll(isPaid?: boolean) {
    const filter = isPaid !== undefined ? { isPaid } : {};
    return this.billModel.find(filter).sort({ createdAt: -1 }).lean();
  }

  async getDailyRevenue() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const result = await this.billModel.aggregate([
      { $match: { isPaid: true, paidAt: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);
    return result[0] ?? { total: 0, count: 0 };
  }
}
