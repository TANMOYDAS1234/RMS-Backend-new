// ─── Order Schema (MongoDB) ──────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document & { createdAt: Date; updatedAt: Date };

export enum OrderStatus {
  CREATED = 'created',
  CONFIRMED = 'confirmed',
  PREPARING = 'preparing',
  READY = 'ready',
  SERVED = 'served',
  BILLED = 'billed',
  PAID = 'paid',
  CLOSED = 'closed',
}

@Schema({ _id: false })
export class OrderItem {
  @Prop({ required: true }) itemId: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) quantity: number;
  @Prop({ required: true }) unitPrice: number;
  @Prop({ default: 0, min: 0, max: 1 }) progress: number;
  @Prop() notes?: string;
}

const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true, optimisticConcurrency: true })
export class Order {
  // Multi-tenant ownership. Stamped from session.branchId (QR flow) or
  // req.user.branchId (staff flow). Indexed because manager dashboards
  // filter by it on nearly every read.
  @Prop({ required: true, index: true }) branchId: string;
  @Prop({ required: true }) tableId: string;
  @Prop({ required: true }) tableLabel: string;
  @Prop({ type: [OrderItemSchema], default: [] }) items: OrderItem[];

  @Prop({ enum: OrderStatus, default: OrderStatus.CREATED })
  status: OrderStatus;

  // Optimistic locking version
  @Prop({ default: 1 }) version: number;

  // Idempotency — store processed keys to prevent duplicate writes
  @Prop({ type: [String], default: [] }) processedKeys: string[];

  @Prop() waiterId?: string;
  @Prop() notes?: string;

  // Billing
  @Prop({ default: 0 }) subtotal: number;
  @Prop({ default: 0 }) gstAmount: number;
  @Prop({ default: 0 }) discountAmount: number;
  @Prop({ default: 0 }) total: number;

  // Audit
  @Prop({ type: [{ action: String, by: String, at: Date, meta: Object }], default: [] })
  auditLog: { action: string; by: string; at: Date; meta?: object }[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Auto-increment version on save
OrderSchema.pre('save', function (next) {
  if (this.isModified() && !this.isNew) {
    this.version += 1;
  }
  next();
});

// Indexes
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ tableId: 1, status: 1 });
OrderSchema.index({ 'processedKeys': 1 });
