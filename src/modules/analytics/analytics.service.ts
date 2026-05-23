// ─── Analytics Service ────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../orders/order.schema';
import { Bill, BillDocument } from '../billing/bill.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
  ) {}

  async getSalesSummary(from: Date, to: Date) {
    return this.billModel.aggregate([
      { $match: { isPaid: true, paidAt: { $gte: from, $lte: to } } },
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

  async getPeakHours() {
    return this.orderModel.aggregate([
      { $match: { status: { $in: [OrderStatus.PAID, OrderStatus.CLOSED] } } },
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

  async getTableTurnover(from: Date, to: Date) {
    return this.orderModel.aggregate([
      {
        $match: {
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

  async getTopItems(limit = 10) {
    return this.orderModel.aggregate([
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
      { $limit: limit },
    ]);
  }

  async getStaffPerformance(from: Date, to: Date) {
    return this.orderModel.aggregate([
      {
        $match: {
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
