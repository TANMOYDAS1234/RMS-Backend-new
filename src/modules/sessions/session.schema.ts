// ─── QR Table Session Schema ─────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SessionDocument = TableSession & Document;

export enum SessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CLOSED = 'closed',
}

@Schema({ timestamps: true })
export class TableSession {
  @Prop({ required: true }) tableId: string;
  @Prop({ required: true }) tableLabel: string;
  @Prop({ required: true }) branchId: string;

  @Prop({ enum: SessionStatus, default: SessionStatus.ACTIVE })
  status: SessionStatus;

  @Prop({ type: [String], default: [] }) orderIds: string[];

  @Prop({ type: [{ deviceId: String, joinedAt: Date }], default: [] })
  participants: { deviceId: string; joinedAt: Date }[];

  @Prop({ required: true }) expiresAt: Date;

  // Blocks new session creation when bill is pending
  @Prop({ default: false }) billPending: boolean;
}

export const SessionSchema = SchemaFactory.createForClass(TableSession);

// TTL — MongoDB auto-removes expired docs
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ tableId: 1, status: 1 });
SessionSchema.index({ branchId: 1, status: 1 });
