import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ingredient, IngredientDocument } from './ingredient.schema';
import { User, UserDocument } from '../users/user.schema';
import { Branch, BranchDocument } from '../branches/branch.schema';
import { UserRole } from '../users/user.schema';
import {
  AuthUser,
  assertOwnsBranch,
  isAdmin,
  resolveBranchIdForCreate,
  roleOf,
  scopeFilter,
} from '../../common/scope/branch-scope';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Ingredient.name) private ingredientModel: Model<IngredientDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Branch.name) private branchModel: Model<BranchDocument>,
    private notifications: NotificationsService,
  ) {}

  /** True when this user is allowed to add or edit ingredient
   * *definitions* (name, unit, thresholds, cost) — not just adjust stock.
   * Admin + manager are always allowed. Chef is allowed only when the
   * branch has chefCanManageInventory toggled on. */
  private async _canChefModifyDefs(branchId: string): Promise<boolean> {
    const b = await this.branchModel.findById(branchId).lean();
    return !!(b as any)?.chefCanManageInventory;
  }

  private async _assertCanModifyDefs(scope: AuthUser, branchId: string) {
    if (isAdmin(scope) || roleOf(scope) === UserRole.MANAGER) return;
    if (roleOf(scope) !== UserRole.CHEF) {
      throw new ForbiddenException('Not allowed to edit ingredient definitions.');
    }
    if (!(await this._canChefModifyDefs(branchId))) {
      throw new ForbiddenException(
        'Your branch does not allow chefs to edit the ingredient list. Ask your manager to enable it.',
      );
    }
  }

  async findAll(scope: AuthUser) {
    return this.ingredientModel.find(scopeFilter(scope)).lean();
  }

  async findLowStock(scope: AuthUser) {
    return this.ingredientModel
      .find({
        ...scopeFilter(scope),
        $expr: { $lte: ['$currentStock', '$lowStockThreshold'] },
      })
      .lean();
  }

  async findById(id: string, scope: AuthUser) {
    const item = await this.ingredientModel.findById(id).lean();
    if (!item) throw new NotFoundException('Ingredient not found');
    assertOwnsBranch(scope, item as any);
    return item;
  }

  async create(
    dto: { name: string; unit: string; currentStock: number; lowStockThreshold: number; costPerUnit?: number; branchId?: string },
    scope: AuthUser,
  ) {
    const branchId = resolveBranchIdForCreate(scope, dto.branchId);
    if (!branchId) throw new BadRequestException('branchId is required');
    await this._assertCanModifyDefs(scope, branchId);
    // Chef adds get auto-flagged for manager review. Manager + admin
    // additions are trusted.
    const pendingReview = roleOf(scope) === UserRole.CHEF;
    return this.ingredientModel.create({ ...dto, branchId, pendingReview });
  }

  async adjustStock(id: string, delta: number, reason: string, by: string, scope: AuthUser) {
    const item = await this.ingredientModel.findById(id);
    if (!item) throw new NotFoundException('Ingredient not found');
    assertOwnsBranch(scope, item as any);

    const wasOk = item.currentStock > item.lowStockThreshold;
    item.currentStock = Math.max(0, item.currentStock + delta);
    item.stockLog.push({ delta, reason, by, at: new Date() });
    await item.save();

    if (wasOk && item.currentStock <= item.lowStockThreshold) {
      this.sendLowStockNotification(
        item.name,
        item.currentStock,
        item.lowStockThreshold,
        item.unit,
        item.branchId,
      ).catch(() => {});
    }

    return item;
  }

  async update(id: string, dto: any, scope: AuthUser) {
    const existing = await this.ingredientModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Ingredient not found');
    assertOwnsBranch(scope, existing as any);
    await this._assertCanModifyDefs(scope, (existing as any).branchId);
    // Don't let callers reassign branchId via update — that bypasses
    // resolveBranchIdForCreate. branchId is set at creation only.
    const safe = { ...dto };
    delete (safe as any).branchId;
    // Chef edits don't re-flag for review — the original creation is
    // what gets audited. Manager edits implicitly clear the pending flag
    // since they're effectively approving the values they touched.
    if (roleOf(scope) === UserRole.MANAGER || isAdmin(scope)) {
      (safe as any).pendingReview = false;
    }
    const item = await this.ingredientModel.findByIdAndUpdate(id, safe, { new: true }).lean();
    return item!;
  }

  async delete(id: string, scope: AuthUser) {
    const existing = await this.ingredientModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Ingredient not found');
    assertOwnsBranch(scope, existing as any);
    await this._assertCanModifyDefs(scope, (existing as any).branchId);
    await this.ingredientModel.findByIdAndDelete(id);
    return { deleted: true };
  }

  /** Manager (or admin) flips pendingReview off after auditing the values
   * a chef entered. Idempotent — re-approving a clean record is a no-op. */
  async approve(id: string, scope: AuthUser) {
    const existing = await this.ingredientModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Ingredient not found');
    assertOwnsBranch(scope, existing as any);
    if (roleOf(scope) === UserRole.CHEF) {
      throw new ForbiddenException('Only a manager or admin can clear pending review.');
    }
    const item = await this.ingredientModel
      .findByIdAndUpdate(id, { pendingReview: false }, { new: true })
      .lean();
    return item!;
  }

  // Delegate to the shared NotificationsService. Recipients = admins
  // (cross-branch) + managers of THIS branch only. The shared service
  // owns OAuth2 token caching, channel routing, and dedup.
  private async sendLowStockNotification(
    name: string,
    current: number,
    threshold: number,
    unit: string,
    branchId: string,
  ) {
    const shortage = (threshold - current).toFixed(1);
    await this.notifications.send(
      { roles: ['manager', 'admin'], branchId },
      {
        type: NotificationType.LOW_STOCK,
        title: 'Low stock alert',
        body: `${name} is at ${current} ${unit} — ${shortage} ${unit} below minimum (${threshold} ${unit})`,
        data: {
          itemName: name,
          current: String(current),
          threshold: String(threshold),
          unit,
          branchId,
        },
      },
    );
  }

  // NOTE: The legacy hand-rolled FCM helpers (getFcmAccessToken,
  // postFcmMessage) were deleted in Phase 3 in favor of
  // NotificationsService. If you need to add a new push type, define a
  // NotificationType enum entry and call notifications.send — don't add
  // another inline HTTPS client here.
}
