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

  // Multi-party support. One physical table can host N independent
  // parties simultaneously (each with their own bill), as long as the
  // sum of partySize across active sessions ≤ table.capacity. A "Party A
  // (2 ppl), Party B (1 ppl)" table of capacity 4 still has 1 free seat.
  @Prop({ default: 1, min: 1 }) partySize: number;

  // Human-readable tag for the party: "A", "B", "C", … Auto-assigned per
  // table as parties come and go (resets when the table is empty).
  // Optional — clients can just show "Party 1" off the index if missing.
  @Prop({ default: '' }) partyLabel: string;

  @Prop({ type: [String], default: [] }) orderIds: string[];

  @Prop({ type: [{ deviceId: String, joinedAt: Date }], default: [] })
  participants: { deviceId: string; joinedAt: Date }[];

  @Prop({ required: true }) expiresAt: Date;

  // Blocks new session creation when bill is pending
  @Prop({ default: false }) billPending: boolean;

  // Call-waiter inbox. Customer taps "Call waiter" → entry pushed here →
  // waiter sees it in the dashboard inbox and dismisses with resolvedAt.
  // Kept on the session (not a separate collection) so the customer's
  // app can show a "your waiter has been notified" badge without an
  // extra round trip.
  @Prop({
    type: [
      {
        id: String,
        at: Date,
        reason: String,
        resolvedAt: Date,
        resolvedBy: String,
      },
    ],
    default: [],
  })
  helpRequests: {
    id: string;
    at: Date;
    reason?: string;
    resolvedAt?: Date;
    resolvedBy?: string;
  }[];
}

export const SessionSchema = SchemaFactory.createForClass(TableSession);

// TTL — MongoDB auto-removes expired docs
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ tableId: 1, status: 1 });
SessionSchema.index({ branchId: 1, status: 1 });
