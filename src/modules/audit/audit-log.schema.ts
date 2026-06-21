// ─── Audit Log Schema ─────────────────────────────────────────────────────────
// Cross-cutting, append-only audit trail. Captures security-relevant events
// (auth success/failure, RBAC mutations) and high-impact business events
// (refunds, inventory approvals) in one queryable collection that survives
// long after the source order/bill is purged.
//
// This is a *separate* trail from:
//   - Order.auditLog[]           (per-order state transitions)
//   - ManagerActionLog           (manager-initiated overrides)
// We keep those for backwards compatibility and per-domain queries.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuditLogDocument = AuditLog & Document & { createdAt: Date };

export enum AuditEventType {
  // Auth
  AUTH_LOGIN = 'AUTH_LOGIN',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_FAILED = 'AUTH_FAILED',
  // RBAC
  RBAC_ROLE_CHANGED = 'RBAC_ROLE_CHANGED',
  // Money
  BILL_REFUNDED = 'BILL_REFUNDED',
  // Inventory
  INVENTORY_APPROVED = 'INVENTORY_APPROVED',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ required: true, enum: AuditEventType, index: true })
  type: AuditEventType;

  // Who did it. Null for failed-login attempts where we never resolved a
  // user, or for system-driven events.
  @Prop({ type: String, default: null, index: true }) actorId: string | null;

  // Actor's email at the time of the event — denormalized so the trail is
  // still readable if the user is later renamed or deleted.
  @Prop({ type: String, default: null }) actorEmail: string | null;

  // Actor's role at the time of the event (admin, manager, …). Denormalized
  // for the same reason as actorEmail.
  @Prop({ type: String, default: null }) actorRole: string | null;

  // Branch scope. Admin events may have no branch; events tied to a
  // branch-owned resource always do.
  @Prop({ type: String, default: null, index: true }) branchId: string | null;

  // Free-form context: previous role, new role, refund amount, ingredient
  // id, IP address, failure reason. Stored as an opaque object because the
  // shape varies per event type.
  @Prop({ type: Object, default: {} }) meta: Record<string, any>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Compound indexes for the common query paths the UI exposes:
//   - "all events of type X in this branch, newest first"
//   - "everything actor Y did, newest first"
AuditLogSchema.index({ type: 1, createdAt: -1 });
AuditLogSchema.index({ branchId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
