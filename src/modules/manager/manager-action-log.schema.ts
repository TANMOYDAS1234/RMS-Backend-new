// ─── Manager Action Log Schema ────────────────────────────────────────────────
// Separate, durable audit trail for manager-only actions (force-close,
// discount, override-status, prioritize, complaint resolve, table status
// changes, shortage reports). Previously these audits were buried inside
// Order.auditLog arrays, which:
//   - made it impossible to query by manager without unwinding every order
//   - lost the action when the order was eventually purged
//   - grew the order document on every manager touch
// This collection is append-only — never updated, never deleted.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ManagerActionLogDocument = ManagerActionLog & Document;

export enum ManagerActionType {
  FORCE_CLOSE = 'FORCE_CLOSE',
  OVERRIDE_STATUS = 'OVERRIDE_STATUS',
  APPLY_DISCOUNT = 'APPLY_DISCOUNT',
  PRIORITIZE = 'PRIORITIZE',
  RESOLVE_COMPLAINT = 'RESOLVE_COMPLAINT',
  TABLE_STATUS_CHANGE = 'TABLE_STATUS_CHANGE',
  REPORT_SHORTAGE = 'REPORT_SHORTAGE',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ManagerActionLog {
  @Prop({ required: true, index: true }) managerId: string;
  @Prop({ required: true, enum: ManagerActionType, index: true }) action: ManagerActionType;

  // What was touched. Most actions target an order; some target other resources.
  @Prop({ type: Types.ObjectId, ref: 'Order', index: true }) orderId?: Types.ObjectId;
  @Prop() tableLabel?: string;
  @Prop({ type: Types.ObjectId, ref: 'Ingredient' }) ingredientId?: Types.ObjectId;

  // Snapshot of the before/after change. Stored loosely because the shape
  // varies per action — query patterns are on (managerId, action, createdAt).
  @Prop({ type: Object }) before?: Record<string, any>;
  @Prop({ type: Object }) after?: Record<string, any>;

  // Free-form reason captured from the manager (discount reason, complaint
  // resolution text, shortage note, etc.).
  @Prop() reason?: string;
}

export const ManagerActionLogSchema =
  SchemaFactory.createForClass(ManagerActionLog);

// Compound index for the "what did manager X do today?" query path.
ManagerActionLogSchema.index({ managerId: 1, createdAt: -1 });
ManagerActionLogSchema.index({ action: 1, createdAt: -1 });
