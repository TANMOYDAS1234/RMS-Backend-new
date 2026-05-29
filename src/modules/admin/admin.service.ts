import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { Order, OrderDocument, OrderStatus } from '../orders/order.schema';
import { Bill, BillDocument } from '../billing/bill.schema';
import { User, UserDocument } from '../users/user.schema';
import { Ingredient, IngredientDocument } from '../inventory/ingredient.schema';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Ingredient.name) private ingredientModel: Model<IngredientDocument>,
  ) {}

  // ── Audit Log: flatten order auditLog[] entries in date range ─────────────
  async getAuditLog(from: Date, to: Date, action?: string, skip = 0, limit = 100) {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const safeSkip = Math.max(skip, 0);
    const matchAudit: any = { 'auditLog.at': { $gte: from, $lte: to } };
    if (action) matchAudit['auditLog.action'] = action;

    const pipeline: any[] = [
      { $match: { createdAt: { $gte: from, $lte: to } } },
      { $unwind: '$auditLog' },
      { $match: matchAudit },
      {
        $project: {
          orderId: '$_id',
          tableLabel: 1,
          action: '$auditLog.action',
          by: '$auditLog.by',
          at: '$auditLog.at',
          meta: '$auditLog.meta',
        },
      },
      { $sort: { at: -1 } },
      {
        $facet: {
          items: [{ $skip: safeSkip }, { $limit: safeLimit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.orderModel.aggregate(pipeline);
    return {
      items: result?.items ?? [],
      total: result?.totalCount?.[0]?.count ?? 0,
      skip: safeSkip,
      limit: safeLimit,
    };
  }

  // ── Password Reset ─────────────────────────────────────────────────────────
  async resetPassword(userId: string, newPassword: string, adminId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return { success: true, message: `Password reset for ${user.email}` };
  }

  // ── Financial Summary (EOD) ────────────────────────────────────────────────
  async getFinancialSummary(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const [revenue, refunds, pending] = await Promise.all([
      this.billModel.aggregate([
        { $match: { isPaid: true, isRefunded: { $ne: true }, paidAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 }, gst: { $sum: '$gstAmount' }, discount: { $sum: '$discountAmount' } } },
      ]),
      this.billModel.aggregate([
        { $match: { isRefunded: true, refundedAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      this.billModel.aggregate([
        { $match: { isPaid: false, createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
    ]);

    const rev = revenue[0] ?? { total: 0, count: 0, gst: 0, discount: 0 };
    const ref = refunds[0] ?? { total: 0, count: 0 };
    const pen = pending[0] ?? { total: 0, count: 0 };

    return {
      date: start.toISOString().split('T')[0],
      grossRevenue: rev.total,
      refundedAmount: ref.total,
      netRevenue: rev.total - ref.total,
      gstCollected: rev.gst,
      totalDiscounts: rev.discount,
      paidOrders: rev.count,
      refundedOrders: ref.count,
      pendingBills: pen.count,
      pendingAmount: pen.total,
    };
  }

  // ── Transaction Log ────────────────────────────────────────────────────────
  async getTransactions(from: Date, to: Date, isPaid?: boolean) {
    const filter: any = { createdAt: { $gte: from, $lte: to } };
    if (isPaid !== undefined) filter.isPaid = isPaid;
    return this.billModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
  }

  // ── Refund ─────────────────────────────────────────────────────────────────
  async processRefund(billId: string, adminId: string) {
    const bill = await this.billModel.findById(billId);
    if (!bill) throw new NotFoundException('Bill not found');
    if (!bill.isPaid) throw new BadRequestException('Bill is not paid');
    if ((bill as any).isRefunded) throw new BadRequestException('Already refunded');

    (bill as any).isRefunded = true;
    (bill as any).refundedAt = new Date();
    (bill as any).refundedBy = adminId.toString();
    await bill.save();

    if ((bill as any).orderId) {
      const order = await this.orderModel.findById((bill as any).orderId);
      if (order && order.status !== OrderStatus.CLOSED) {
        const prev = order.status;
        order.status = OrderStatus.CLOSED;
        order.auditLog.push({
          action: 'REFUND_PROCESSED',
          by: adminId.toString(),
          at: new Date(),
          meta: { previousStatus: prev, billId: bill._id.toString(), refundAmount: bill.total },
        });
        await order.save();
      }
    }
    return bill;
  }

  // ── Profit Margin ──────────────────────────────────────────────────────────
  async getProfitMargin(from: Date, to: Date) {
    const [revenue, costData] = await Promise.all([
      this.billModel.aggregate([
        { $match: { isPaid: true, isRefunded: { $ne: true }, paidAt: { $gte: from, $lte: to } } },
        { $group: { _id: null, revenue: { $sum: '$total' }, gst: { $sum: '$gstAmount' } } },
      ]),
      // Estimate cost from stock adjustments (negative deltas = consumption)
      this.ingredientModel.aggregate([
        { $unwind: '$stockLog' },
        { $match: { 'stockLog.at': { $gte: from, $lte: to }, 'stockLog.delta': { $lt: 0 } } },
        {
          $group: {
            _id: null,
            estimatedCost: {
              $sum: { $multiply: [{ $abs: '$stockLog.delta' }, '$costPerUnit'] },
            },
          },
        },
      ]),
    ]);

    const rev = revenue[0] ?? { revenue: 0, gst: 0 };
    const cost = costData[0] ?? { estimatedCost: 0 };
    const netRevenue = rev.revenue - rev.gst;
    const profit = netRevenue - cost.estimatedCost;
    const margin = netRevenue > 0 ? +((profit / netRevenue) * 100).toFixed(2) : 0;

    return {
      grossRevenue: rev.revenue,
      gstCollected: rev.gst,
      netRevenue,
      estimatedCOGS: cost.estimatedCost,
      grossProfit: profit,
      profitMarginPercent: margin,
    };
  }

  // ── Force Close Order ──────────────────────────────────────────────────────
  async forceCloseOrder(orderId: string, adminId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.CLOSED) throw new BadRequestException('Already closed');

    const prev = order.status;
    order.status = OrderStatus.CLOSED;
    order.auditLog.push({ action: 'FORCE_CLOSED', by: adminId.toString(), at: new Date(), meta: { previousStatus: prev } });
    return order.save();
  }

  // ── System Health ──────────────────────────────────────────────────────────
  async getSystemHealth() {
    const [activeOrders, lowStock, unpaidBills, activeUsers] = await Promise.all([
      this.orderModel.countDocuments({ status: { $nin: [OrderStatus.CLOSED, OrderStatus.PAID] } }),
      this.ingredientModel.countDocuments({ $expr: { $lte: ['$currentStock', '$lowStockThreshold'] } }),
      this.billModel.countDocuments({ isPaid: false }),
      this.userModel.countDocuments({ isActive: true }),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      activeOrders,
      lowStockAlerts: lowStock,
      unpaidBills,
      activeUsers,
    };
  }
}
