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

  async updateFeatures(id: string, features: Partial<Branch['features']>) {
    const b = await this.branchModel.findByIdAndUpdate(
      id,
      { $set: { features } },
      { new: true },
    ).lean();
    if (!b) throw new NotFoundException('Branch not found');
    return b;
  }

  async isQrOrderingEnabled(branchId: string): Promise<boolean> {
    const branch = await this.findById(branchId);
    if (!branch.features.qrOrdering) return false;

    const { qrOrderingActiveFrom, qrOrderingActiveTo } = branch.features;
    if (!qrOrderingActiveFrom || !qrOrderingActiveTo) return true;

    const now = new Date();
    const [fh, fm] = qrOrderingActiveFrom.split(':').map(Number);
    const [th, tm] = qrOrderingActiveTo.split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    return nowMins >= fh * 60 + fm && nowMins <= th * 60 + tm;
  }
}
