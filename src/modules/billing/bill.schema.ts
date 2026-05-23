// ─── Billing Schema ──────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BillDocument = Bill & Document;

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  UPI = 'upi',
  SPLIT = 'split',
}

@Schema({ _id: false })
class SplitPayment {
  @Prop({ enum: PaymentMethod }) method: PaymentMethod;
  @Prop({ required: true }) amount: number;
}

@Schema({ timestamps: true })
export class Bill {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Order' }) orderId: Types.ObjectId;
  @Prop({ required: true }) tableLabel: string;
  @Prop({ required: true }) subtotal: number;
  @Prop({ default: 0 }) discountAmount: number;
  @Prop({ default: 0 }) discountPercent: number;
  @Prop({ required: true }) gstAmount: number;
  @Prop({ required: true }) total: number;
  @Prop({ enum: PaymentMethod }) paymentMethod?: PaymentMethod;
  @Prop({ type: [SplitPayment], default: [] }) splitPayments: SplitPayment[];
  @Prop({ default: false }) isPaid: boolean;
  @Prop() paidAt?: Date;
  @Prop() cashierId?: string;
  @Prop({ type: [String], default: [] }) processedKeys: string[];

  // Refund tracking (admin only)
  @Prop({ default: false }) isRefunded: boolean;
  @Prop() refundedAt?: Date;
  @Prop() refundedBy?: string;
}

export const BillSchema = SchemaFactory.createForClass(Bill);
BillSchema.index({ orderId: 1 });
BillSchema.index({ isPaid: 1, createdAt: -1 });
