// ─── Table Schema ────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TableDocument = Table & Document;

export enum TableStatus {
  AVAILABLE = 'available',
  OCCUPIED = 'occupied',
  RESERVED = 'reserved',
  CLEANING = 'cleaning',
}

@Schema({ timestamps: true })
export class Table {
  // Per-branch ownership. Tables are scoped to a single physical branch.
  @Prop({ required: true, index: true }) branchId: string;
  @Prop({ required: true }) label: string;
  @Prop({ required: true, min: 1 }) capacity: number;
  @Prop({ enum: TableStatus, default: TableStatus.AVAILABLE }) status: TableStatus;
  @Prop() activeOrderId?: string;
  @Prop() qrCode?: string; // base64 QR for customer ordering
}

export const TableSchema = SchemaFactory.createForClass(Table);
TableSchema.index({ status: 1 });
// Table label uniqueness must be per-branch, not global. Different branches
// can both have "T-01".
TableSchema.index({ branchId: 1, label: 1 }, { unique: true });
