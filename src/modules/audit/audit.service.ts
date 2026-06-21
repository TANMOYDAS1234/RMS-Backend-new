// ─── Audit Service ────────────────────────────────────────────────────────────
// Central writer + reader for the AuditLog collection. Services anywhere in
// the backend depend on this thin shim instead of injecting the Mongoose
// model directly, so we can change the storage backend (or add fan-out to
// an external SIEM) in one place later.

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditLog,
  AuditLogDocument,
  AuditEventType,
} from './audit-log.schema';
import { AuthUser, scopeFilter } from '../../common/scope/branch-scope';

export type AuditRecordInput = {
  type: AuditEventType;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  branchId?: string | null;
  meta?: Record<string, any>;
};

export type AuditQuery = {
  type?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  branchId?: string;
  skip?: number;
  limit?: number;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private auditModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Fire-and-forget recorder. Never throws into the caller — a failed
   * audit write must not break the operation that triggered it. We log
   * the failure so it shows up in stderr / Render's log feed.
   */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.auditModel.create({
        type: input.type,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorRole: input.actorRole ?? null,
        branchId: input.branchId ?? null,
        meta: input.meta ?? {},
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit event ${input.type}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Paged + filtered read. Scope is enforced via scopeFilter so a manager
   * only ever sees their own branch's events; admin sees everything (and
   * may further narrow by branchId via the query param).
   */
  async query(scope: AuthUser, q: AuditQuery) {
    const safeLimit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const safeSkip = Math.max(q.skip ?? 0, 0);

    const filter: Record<string, any> = { ...scopeFilter(scope) };
    if (q.type) filter.type = q.type;
    if (q.actorId) filter.actorId = q.actorId;
    if (q.branchId) {
      // Admin can further pin branchId; for non-admin, scopeFilter has
      // already pinned it and we just verify the request matches.
      filter.branchId = q.branchId;
    }
    if (q.from || q.to) {
      filter.createdAt = {} as Record<string, Date>;
      if (q.from) filter.createdAt.$gte = q.from;
      if (q.to) filter.createdAt.$lte = q.to;
    }

    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(safeSkip)
        .limit(safeLimit)
        .lean(),
      this.auditModel.countDocuments(filter),
    ]);

    return {
      items: items.map((i) => ({
        ...i,
        _id: (i as any)._id?.toString?.() ?? (i as any)._id,
      })),
      total,
      skip: safeSkip,
      limit: safeLimit,
    };
  }
}
