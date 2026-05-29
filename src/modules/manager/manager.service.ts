import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../orders/order.schema';
import { Bill, BillDocument } from '../billing/bill.schema';
import { User, UserDocument } from '../users/user.schema';
import { Ingredient, IngredientDocument } from '../inventory/ingredient.schema';
import { Table, TableDocument, TableStatus } from '../tables/table.schema';
import { OrdersGateway } from '../../gateways/orders.gateway';

@Injectable()
export class ManagerService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Ingredient.name) private ingredientModel: Model<IngredientDocument>,
    @InjectModel(Table.name) private tableModel: Model<TableDocument>,
    private readonly gateway: OrdersGateway,
  ) {}

  // ── Operations: live order pipeline ────────────────────────────────────────
  async getOperationsSummary() {
    const [orders, tables, lowStock, unpaidBills, dailyRev] = await Promise.all([
      this.orderModel.find({ status: { $nin: [OrderStatus.CLOSED, OrderStatus.PAID] } }).lean(),
      this.tableModel.find().lean(),
      this.ingredientModel.countDocuments({ $expr: { $lte: ['$currentStock', '$lowStockThreshold'] } }),
      this.billModel.countDocuments({ isPaid: false }),
      this._getDailyRevenue(),
    ]);

    const pipeline: Record<string, number> = {};
    for (const s of Object.values(OrderStatus)) pipeline[s] = 0;
    for (const o of orders) pipeline[o.status] = (pipeline[o.status] ?? 0) + 1;

    const delayed = orders.filter((o) => {
      const mins = (Date.now() - new Date(o.updatedAt as any).getTime()) / 60000;
      return mins > 15 && [OrderStatus.CONFIRMED, OrderStatus.PREPARING].includes(o.status as OrderStatus);
    });

    return {
      activeOrders: orders.length,
      occupiedTables: tables.filter((t) => t.status === TableStatus.OCCUPIED).length,
      totalTables: tables.length,
      lowStockAlerts: lowStock,
      unpaidBills,
      dailyRevenue: dailyRev,
      pipeline,
      delayedOrders: delayed.map((o) => ({
        id: o._id,
        tableLabel: o.tableLabel,
        status: o.status,
        minutesElapsed: Math.floor((Date.now() - new Date(o.updatedAt as any).getTime()) / 60000),
      })),
    };
  }

  // ── Force-close order (manager override) ───────────────────────────────────
  async forceCloseOrder(orderId: string, managerId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.CLOSED) throw new BadRequestException('Already closed');
    const prev = order.status;
    order.status = OrderStatus.CLOSED;
    order.auditLog.push({ action: 'FORCE_CLOSED_MANAGER', by: managerId, at: new Date(), meta: { previousStatus: prev } });
    await order.save();
    this.gateway.emitOrderUpdated(order);
    return order;
  }

  // ── Override order status ───────────────────────────────────────────────────
  async overrideStatus(orderId: string, status: OrderStatus, managerId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    const prev = order.status;
    order.status = status;
    order.auditLog.push({ action: 'STATUS_OVERRIDE', by: managerId, at: new Date(), meta: { from: prev, to: status } });
    await order.save();
    this.gateway.emitOrderUpdated(order);
    return order;
  }

  // ── Tables: full list with occupancy ───────────────────────────────────────
  async getTablesWithOccupancy(): Promise<any[]> {
    const [tables, activeOrders] = await Promise.all([
      this.tableModel.find().lean(),
      this.orderModel.find({ status: { $nin: [OrderStatus.CLOSED, OrderStatus.PAID] } }).lean(),
    ]);
    return tables.map((t) => {
      const order = activeOrders.find((o) => o.tableId === t._id.toString());
      return { ...t, currentOrder: order ?? null };
    });
  }

  async updateTableStatus(tableId: string, status: TableStatus) {
    const table = await this.tableModel.findByIdAndUpdate(tableId, { status }, { new: true }).lean();
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  // ── Staff: list with today's order count ───────────────────────────────────
  async getStaffWithActivity(): Promise<any[]> {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [staff, orders] = await Promise.all([
      this.userModel.find({ role: { $in: ['waiter', 'chef', 'cashier', 'manager'] } }).select('-password').lean(),
      this.orderModel.find({ createdAt: { $gte: today } }).lean(),
    ]);
    return staff.map((s) => ({
      ...s,
      todayOrders: orders.filter((o) => o.waiterId === s._id.toString()).length,
    }));
  }

  // ── Discount approval ──────────────────────────────────────────────────────
  async applyDiscount(orderId: string, discountPercent: number, managerId: string, reason: string) {
    if (discountPercent < 0 || discountPercent > 100) throw new BadRequestException('Invalid discount');
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const discountAmount = +(order.subtotal * (discountPercent / 100)).toFixed(2);
    const gstAmount = +((order.subtotal - discountAmount) * 0.18).toFixed(2);
    const total = +(order.subtotal - discountAmount + gstAmount).toFixed(2);

    order.discountAmount = discountAmount;
    order.gstAmount = gstAmount;
    order.total = total;
    order.auditLog.push({ action: 'DISCOUNT_APPLIED', by: managerId, at: new Date(), meta: { discountPercent, reason } });
    await order.save();

    // Also update bill if exists
    await this.billModel.findOneAndUpdate(
      { orderId: order._id },
      { discountAmount, discountPercent, gstAmount, total },
    );
    return order;
  }

  // ── Pending discount requests (bills with no discount yet) ─────────────────
  async getPendingDiscountRequests() {
    return this.billModel.find({ isPaid: false, discountPercent: 0 }).lean();
  }

  // ── Kitchen workload ───────────────────────────────────────────────────────
  async getKitchenWorkload() {
    const orders = await this.orderModel
      .find({ status: { $in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] } })
      .sort({ createdAt: 1 })
      .lean();

    return orders.map((o) => ({
      id: o._id,
      tableLabel: o.tableLabel,
      status: o.status,
      itemCount: o.items.length,
      minutesElapsed: Math.floor((Date.now() - new Date(o.createdAt as any).getTime()) / 60000),
      isUrgent: Math.floor((Date.now() - new Date(o.updatedAt as any).getTime()) / 60000) > 15,
      items: o.items,
    }));
  }

  // ── Prioritize order (move to top of kitchen queue via audit) ──────────────
  async prioritizeOrder(orderId: string, managerId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    order.auditLog.push({ action: 'PRIORITIZED', by: managerId, at: new Date() });
    await order.save();
    this.gateway.emitOrderUpdated(order);
    return order;
  }

  // ── Inventory: low stock + full list ───────────────────────────────────────
  async getInventoryStatus() {
    const items = await this.ingredientModel.find().lean();
    const low = items.filter((i) => i.currentStock <= i.lowStockThreshold);
    return { items, lowCount: low.length, lowItems: low };
  }

  async reportShortage(ingredientId: string, managerId: string, note: string) {
    const item = await this.ingredientModel.findById(ingredientId);
    if (!item) throw new NotFoundException('Ingredient not found');
    item.stockLog.push({ delta: 0, reason: `SHORTAGE_REPORTED: ${note}`, by: managerId, at: new Date() });
    return item.save();
  }

  // ── Reports ────────────────────────────────────────────────────────────────
  async getOperationalReport() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [orders, bills, staffActivity] = await Promise.all([
      this.orderModel.find({ createdAt: { $gte: today } }).lean(),
      this.billModel.find({ createdAt: { $gte: today } }).lean(),
      this.orderModel.aggregate([
        { $match: { createdAt: { $gte: today }, waiterId: { $exists: true } } },
        { $group: { _id: '$waiterId', count: { $sum: 1 }, revenue: { $sum: '$total' } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const statusBreakdown: Record<string, number> = {};
    for (const o of orders) statusBreakdown[o.status] = (statusBreakdown[o.status] ?? 0) + 1;

    const avgServiceTime = orders.length > 0
      ? orders.reduce((sum, o) => {
          const mins = (new Date(o.updatedAt as any).getTime() - new Date(o.createdAt as any).getTime()) / 60000;
          return sum + mins;
        }, 0) / orders.length
      : 0;

    return {
      date: today.toISOString().split('T')[0],
      totalOrders: orders.length,
      paidBills: bills.filter((b) => b.isPaid).length,
      totalRevenue: bills.filter((b) => b.isPaid).reduce((s, b) => s + b.total, 0),
      avgServiceTimeMinutes: +avgServiceTime.toFixed(1),
      statusBreakdown,
      staffActivity,
    };
  }

  // ── Customer complaints log ────────────────────────────────────────────────
  async logComplaint(tableLabel: string, issue: string, managerId: string) {
    // Store as audit entry on the most recent order for that table
    const order = await this.orderModel.findOne({ tableLabel }).sort({ createdAt: -1 });
    if (order) {
      order.auditLog.push({ action: 'COMPLAINT_LOGGED', by: managerId, at: new Date(), meta: { issue } });
      await order.save();
    }
    return { logged: true, tableLabel, issue };
  }

  async getComplaints() {
    return this.orderModel.aggregate([
      { $unwind: '$auditLog' },
      { $match: { 'auditLog.action': 'COMPLAINT_LOGGED' } },
      { $project: { tableLabel: 1, issue: '$auditLog.meta.issue', by: '$auditLog.by', at: '$auditLog.at' } },
      { $sort: { at: -1 } },
      { $limit: 100 },
    ]);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async _getDailyRevenue() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const res = await this.billModel.aggregate([
      { $match: { isPaid: true, paidAt: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);
    return res[0] ?? { total: 0, count: 0 };
  }
}
