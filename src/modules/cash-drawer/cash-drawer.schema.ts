// ─── Cash Drawer Shift Schema ────────────────────────────────────────────────
//
// One row per cashier "shift". openShift() creates it with the cash the
// cashier counts at start; closeShift() records the count at end and
// computes the expected total from cash bills paid during the shift,
// surfacing variance. There can be only ONE open shift per (branch,
// cashier) at a time.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CashDrawerShiftDocument = CashDrawerShift & Document;

export enum ShiftStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

@Schema({ timestamps: true })
export class CashDrawerShift {
  // Branch ownership — same scoping primitive as everything else in
  // Phase 1. A manager can list every shift in their branch; a cashier
  // can only operate on their own.
  @Prop({ required: true, index: true }) branchId: string;
  @Prop({ required: true, index: true }) cashierId: string;
  @Prop() cashierName?: string;

  @Prop({ enum: ShiftStatus, default: ShiftStatus.OPEN, index: true })
  status: ShiftStatus;

  @Prop({ required: true, min: 0 }) openingBalance: number;
  @Prop({ default: new Date() }) openedAt: Date;

  // Set on close.
  @Prop({ min: 0 }) closingBalance?: number;
  @Prop() closedAt?: Date;
  /** Sum of cash payments collected during this shift. */
  @Prop() expectedCash?: number;
  /** closingBalance - (openingBalance + expectedCash). Positive = surplus. */
  @Prop() variance?: number;
  @Prop() closingNote?: string;
}

export const CashDrawerShiftSchema = SchemaFactory.createForClass(CashDrawerShift);
// Prevent two open shifts for the same cashier at the same time.
CashDrawerShiftSchema.index(
  { cashierId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: ShiftStatus.OPEN } },
);
