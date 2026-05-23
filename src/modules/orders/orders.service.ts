// ─── Orders Service ──────────────────────────────────────────────────────────

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from './order.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { OrdersGateway } from '../../gateways/orders.gateway';

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

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private readonly gateway: OrdersGateway,
  ) {}

  async create(dto: CreateOrderDto, userId: string, idempotencyKey: string): Promise<Order> {
    // Idempotency check
    const existing = await this.orderModel.findOne({
      processedKeys: idempotencyKey,
    });
    if (existing) return existing;

    const subtotal = dto.items.reduce(
      (sum, i) => sum + i.unitPrice * i.quantity,
      0,
    );
    const gstAmount = +(subtotal * 0.18).toFixed(2);
    const total = +(subtotal + gstAmount).toFixed(2);

    const order = await this.orderModel.create({
      ...dto,
      waiterId: userId,
      subtotal,
      gstAmount,
      total,
      processedKeys: [idempotencyKey],
      auditLog: [{ action: 'CREATED', by: userId, at: new Date() }],
    });

    this.gateway.emitOrderCreated(order);
    return order;
  }

  async getActiveOrders(): Promise<Order[]> {
    return this.orderModel
      .find({
        status: {
          $nin: [OrderStatus.PAID, OrderStatus.CLOSED],
        },
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
      return order;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
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
