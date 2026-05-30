// ─── Branch-scope helpers ───────────────────────────────────────────────────
//
// Multi-tenant primitive. Translates the authenticated user's (role, branchId)
// into either:
//   - a Mongo query filter ({} for admin, { branchId } for everyone else), or
//   - an ownership assertion ("does this document belong to the user?").
//
// One file, one mental model — every controller/service uses the same
// helpers so a new endpoint can't reintroduce a cross-branch leak by accident.

import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../modules/users/user.schema';

export type AuthUser = {
  _id?: any;
  role?: UserRole | string;
  branchId?: string | null;
};

/**
 * Returns the role string regardless of whether `role` is a UserRole enum or
 * a raw string from a lean Mongo doc.
 */
export function roleOf(user: AuthUser): string {
  return (user?.role ?? '').toString();
}

/** Admin is the only role allowed to see across branches. */
export function isAdmin(user: AuthUser): boolean {
  return roleOf(user) === UserRole.ADMIN;
}

/**
 * Filter to AND into a Mongo `.find()` so callers only see their branch.
 *
 *   const filter = { isActive: true, ...scopeFilter(req.user) };
 *   await this.orderModel.find(filter);
 *
 * Admin → `{}` (all branches). Anyone else → `{ branchId: req.user.branchId }`.
 * Throws if a non-admin has no branchId on file — that's a misconfigured
 * account and we'd rather fail loud than silently leak.
 */
export function scopeFilter(user: AuthUser): Record<string, any> {
  if (isAdmin(user)) return {};
  if (!user?.branchId) {
    throw new ForbiddenException(
      'Account is not assigned to a branch. Contact an administrator.',
    );
  }
  return { branchId: user.branchId };
}

/**
 * Assert that a target document belongs to the caller's branch (or that the
 * caller is admin). Use this on mutate paths after loading the doc:
 *
 *   const order = await this.orderModel.findById(id);
 *   assertOwnsBranch(req.user, order);
 *   ... mutate ...
 */
export function assertOwnsBranch(user: AuthUser, doc: { branchId?: any }): void {
  if (isAdmin(user)) return;
  if (!user?.branchId) {
    throw new ForbiddenException(
      'Account is not assigned to a branch. Contact an administrator.',
    );
  }
  if (!doc || (doc.branchId?.toString?.() ?? doc.branchId) !== user.branchId) {
    throw new ForbiddenException('Resource belongs to a different branch.');
  }
}

/**
 * When a manager POSTs a new resource, force the new doc's branchId to be
 * theirs. Admin may set any branchId (or none) explicitly via the body.
 */
export function resolveBranchIdForCreate(
  user: AuthUser,
  bodyBranchId?: string | null,
): string | undefined {
  if (isAdmin(user)) return bodyBranchId ?? undefined;
  if (!user?.branchId) {
    throw new ForbiddenException(
      'Account is not assigned to a branch. Contact an administrator.',
    );
  }
  if (bodyBranchId && bodyBranchId !== user.branchId) {
    throw new ForbiddenException(
      'Cannot create resources outside your own branch.',
    );
  }
  return user.branchId;
}
