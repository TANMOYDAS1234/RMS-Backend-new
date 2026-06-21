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
  // Multi-tenant ownership — stamped from order.branchId on bill creation.
  @Prop({ required: true, index: true }) branchId: string;
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

  // Tip is tracked separately from total — the bill total is settled at
  // generation time; tips are captured at payment and reported separately.
  @Prop({ default: 0, min: 0 }) tipAmount: number;

  // Refund tracking. Two layers:
  //   * isRefunded / refundedAt / refundedBy — terminal state after a manager
  //     (or admin) approves and the gateway returns success. Stamped exactly
  //     once, only on APPROVED.
  //   * refundStatus / refundReason / refundReference / refundRequestedBy /
  //     refundApprovedBy / refundDeniedBy / refundRequestedAt /
  //     refundResolvedAt — request lifecycle so a cashier can flag a bill for
  //     refund with a reason and a manager can approve or deny. PENDING means
  //     awaiting a decision; APPROVED means refund executed; DENIED means the
  //     manager rejected the request.
  @Prop({ default: false }) isRefunded: boolean;
  @Prop() refundedAt?: Date;
  @Prop() refundedBy?: string;
  @Prop() refundReason?: string;
  @Prop() refundReference?: string;
  @Prop({ enum: ['PENDING', 'APPROVED', 'DENIED'], default: null }) refundStatus?: 'PENDING' | 'APPROVED' | 'DENIED';
  @Prop() refundRequestedBy?: string;
  @Prop() refundApprovedBy?: string;
  @Prop() refundDeniedBy?: string;
  @Prop() refundRequestedAt?: Date;
  @Prop() refundResolvedAt?: Date;

  // Razorpay sandbox references. Stored for later reconciliation against
  // the Razorpay dashboard — not used to authorize anything server-side.
  @Prop() razorpayPaymentId?: string;
  @Prop() razorpayOrderId?: string;
}

export const BillSchema = SchemaFactory.createForClass(Bill);
BillSchema.index({ orderId: 1 });
BillSchema.index({ isPaid: 1, createdAt: -1 });
