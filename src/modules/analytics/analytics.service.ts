// ─── Analytics Service ────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../orders/order.schema';
import { Bill, BillDocument } from '../billing/bill.schema';
import { AuthUser, scopeFilter } from '../../common/scope/branch-scope';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
  ) {}

  // Every aggregate now starts with the multi-tenant filter so a manager
  // only sees their own branch's analytics. Admin gets `{}` from
  // scopeFilter and sees the whole chain. Without this the manager
  // panel showed cross-branch totals (other branches' revenue, other
  // branches' staff in the top performers list) — the analytics fix.

  async getSalesSummary(from: Date, to: Date, scope?: AuthUser) {
    const sf = scope ? scopeFilter(scope) : {};
    return this.billModel.aggregate([
      { $match: { ...sf, isPaid: true, paidAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
          avgOrderValue: { $avg: '$total' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }

  async getPeakHours(from?: Date, to?: Date, scope?: AuthUser) {
    const sf = scope ? scopeFilter(scope) : {};
    const match: any = {
      ...sf,
      status: { $in: [OrderStatus.PAID, OrderStatus.CLOSED] },
    };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }
    return this.orderModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { hour: '$_id', count: 1, _id: 0 } },
    ]);
  }

  async getTableTurnover(from: Date, to: Date, scope?: AuthUser) {
    const sf = scope ? scopeFilter(scope) : {};
    return this.orderModel.aggregate([
      {
        $match: {
          ...sf,
          status: OrderStatus.CLOSED,
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: '$tableId',
          tableLabel: { $first: '$tableLabel' },
          turnoverCount: { $sum: 1 },
          avgRevenue: { $avg: '$total' },
        },
      },
      { $sort: { turnoverCount: -1 } },
    ]);
  }

  async getTopItems(limit = 10, from?: Date, to?: Date, scope?: AuthUser) {
    const sf = scope ? scopeFilter(scope) : {};
    const pipeline: any[] = [];
    const match: any = { ...sf };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });
    pipeline.push(
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.itemId',
          name: { $first: '$items.name' },
          totalQty: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } },
        },
      },
      { $sort: { totalQty: -1 } },
      { $limit: Math.max(1, Math.min(limit, 100)) },
    );
    return this.orderModel.aggregate(pipeline);
  }

  async getStaffPerformance(from: Date, to: Date, scope?: AuthUser) {
    const sf = scope ? scopeFilter(scope) : {};
    return this.orderModel.aggregate([
      {
        $match: {
          ...sf,
          waiterId: { $exists: true },
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: '$waiterId',
          ordersHandled: { $sum: 1 },
          totalRevenue: { $sum: '$total' },
        },
      },
      { $sort: { ordersHandled: -1 } },
    ]);
  }
}
