import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Branch, BranchDocument } from './branch.schema';

@Injectable()
export class BranchesService {
  constructor(@InjectModel(Branch.name) private branchModel: Model<BranchDocument>) {}

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

  create(dto: { name: string; address: string; slug: string }) {
    return this.branchModel.create(dto);
  }

  async update(id: string, dto: Partial<{ name: string; address: string; slug: string; gstRate: number; isActive: boolean }>) {
    const b = await this.branchModel.findByIdAndUpdate(id, dto, { new: true }).lean();
    if (!b) throw new NotFoundException('Branch not found');
    return b;
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

  async delete(id: string) {
    await this.branchModel.findByIdAndDelete(id);
    return { deleted: true };
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
