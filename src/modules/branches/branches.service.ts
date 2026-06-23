import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Branch, BranchDocument } from './branch.schema';
import { User, UserDocument } from '../users/user.schema';
import { MenuItem, MenuItemDocument } from '../menu/menu.schema';
import { Table, TableDocument } from '../tables/table.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Bill, BillDocument } from '../billing/bill.schema';
import { Ingredient, IngredientDocument } from '../inventory/ingredient.schema';

// Mongo duplicate-key error code. Mongoose wraps slug-clash errors as
// `code: 11000` rather than a typed exception, so we sniff for it
// when create/update fails and re-throw as a friendly 409.
const MONGO_DUP_KEY = 11000;

@Injectable()
export class BranchesService {
  constructor(
    @InjectModel(Branch.name) private branchModel: Model<BranchDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
    @InjectModel(Table.name) private tableModel: Model<TableDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
    @InjectModel(Ingredient.name) private ingredientModel: Model<IngredientDocument>,
  ) {}

  findAll() { return this.branchModel.find().lean(); }

  async findById(id: string) {
    const b = await this.branchModel.findById(id).lean();
    if (!b) throw new NotFoundException('Branch not found');
    return b;
  }

  async findBySlug(slug: string) {
    const b = await this.branchModel.findOne({ slug }).lean();
    if (!b) throw new NotFoundException('Branch not found');
    return b;
  }

  async create(dto: { name: string; address: string; slug: string }) {
    try {
      return await this.branchModel.create(dto);
    } catch (err: any) {
      // E11000 = duplicate key. The branch schema has unique:true on slug,
      // so this fires when admin tries to create a branch whose slug is
      // already in use. Surface as a 409 with a clear message so the UI
      // can show "Slug already in use" instead of a generic 500.
      if (err?.code === MONGO_DUP_KEY) {
        throw new ConflictException(`Slug "${dto.slug}" is already in use.`);
      }
      throw err;
    }
  }

  async update(id: string, dto: Partial<{ name: string; address: string; slug: string; gstRate: number; isActive: boolean; overdueAfterMinutes: number }>) {
    try {
      const b = await this.branchModel.findByIdAndUpdate(id, dto, { new: true, runValidators: true }).lean();
      if (!b) throw new NotFoundException('Branch not found');
      return b;
    } catch (err: any) {
      // Edit can also collide on slug — same friendly surface.
      if (err?.code === MONGO_DUP_KEY) {
        throw new ConflictException(`Slug "${dto.slug}" is already in use.`);
      }
      throw err;
    }
  }

  async updateFeatures(id: string, features: Record<string, any>) {
    const setPayload: Record<string, any> = {};
    for (const key of Object.keys(features)) {
      setPayload[`features.${key}`] = features[key];
    }
    const b = await this.branchModel.findByIdAndUpdate(
      id,
      { $set: setPayload },
      { new: true },
    ).lean();
    if (!b) throw new NotFoundException('Branch not found');
    return b;
  }

  /// Count every resource pointing at this branch so the admin UI can
  /// show "deleting this will orphan N users, M menu items…" before the
  /// admin pulls the trigger. Cheap counts in parallel — no model scans
  /// the whole collection.
  async getDeletionPreview(id: string) {
    const branchObjId = id;
    const [users, menus, tables, orders, bills, ingredients] = await Promise.all([
      this.userModel.countDocuments({ branchId: branchObjId }),
      this.menuModel.countDocuments({ branchId: branchObjId }),
      this.tableModel.countDocuments({ branchId: branchObjId }),
      this.orderModel.countDocuments({ branchId: branchObjId }),
      this.billModel.countDocuments({ branchId: branchObjId }),
      this.ingredientModel.countDocuments({ branchId: branchObjId }),
    ]);
    const total = users + menus + tables + orders + bills + ingredients;
    return {
      branchId: id,
      counts: { users, menus, tables, orders, bills, ingredients },
      total,
      hasDependents: total > 0,
    };
  }

  /// Delete a branch. If `cascade` is true, every dependent doc is
  /// removed in the same operation (admin confirmed they understand
  /// the blast radius); otherwise we refuse the delete when there are
  /// dependents so the admin can't silently orphan half the org by
  /// tapping Delete by mistake.
  async delete(id: string, cascade = false) {
    const preview = await this.getDeletionPreview(id);
    if (preview.hasDependents && !cascade) {
      throw new ConflictException({
        message:
          'Branch has dependent records. Re-issue the delete with cascade=true to remove them.',
        ...preview,
      });
    }
    if (cascade && preview.hasDependents) {
      await Promise.all([
        this.userModel.deleteMany({ branchId: id }),
        this.menuModel.deleteMany({ branchId: id }),
        this.tableModel.deleteMany({ branchId: id }),
        this.orderModel.deleteMany({ branchId: id }),
        this.billModel.deleteMany({ branchId: id }),
        this.ingredientModel.deleteMany({ branchId: id }),
      ]);
    }
    await this.branchModel.findByIdAndDelete(id);
    return { deleted: true, cascaded: cascade && preview.hasDependents, counts: preview.counts };
  }

  async isQrOrderingEnabled(branchId: string): Promise<boolean> {
    const branch = await this.findById(branchId);
    // Soft-deleted/disabled branches are off-limits regardless of feature
    // flag — a restaurant in 'isActive: false' shouldn't be taking orders.
    if (!(branch as any).isActive) return false;
    if (!branch.features.qrOrdering) return false;

    const { qrOrderingActiveFrom, qrOrderingActiveTo } = branch.features;
    if (!qrOrderingActiveFrom || !qrOrderingActiveTo) return true;

    const now = new Date();
    const [fh, fm] = qrOrderingActiveFrom.split(':').map(Number);
    const [th, tm] = qrOrderingActiveTo.split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const fromMins = fh * 60 + fm;
    const toMins = th * 60 + tm;
    // Handle overnight windows like 22:00 → 02:00. When from > to the window
    // wraps midnight, so "in window" means `now >= from OR now <= to`.
    return fromMins <= toMins
      ? nowMins >= fromMins && nowMins <= toMins
      : nowMins >= fromMins || nowMins <= toMins;
  }
}
