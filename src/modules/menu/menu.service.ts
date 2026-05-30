import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuItem, MenuItemDocument } from './menu.schema';
import {
  AuthUser,
  assertOwnsBranch,
  resolveBranchIdForCreate,
} from '../../common/scope/branch-scope';

@Injectable()
export class MenuService {
  constructor(@InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>) {}

  async findByBranch(branchId: string, category?: string) {
    const filter: any = { branchId, isAvailable: true };
    if (category) filter.category = category;
    return this.menuModel.find(filter).select('-imageData -glbData').lean();
  }

  async findByBranchAdmin(branchId: string, scope: AuthUser) {
    // Manager can only see their own branch's admin view, admin sees any.
    assertOwnsBranch(scope, { branchId } as any);
    return this.menuModel.find({ branchId }).select('-imageData -glbData').lean();
  }

  async findById(id: string) {
    const item = await this.menuModel.findById(id).lean();
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async create(dto: any, scope: AuthUser) {
    const branchId = resolveBranchIdForCreate(scope, dto.branchId);
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.menuModel.create({ ...dto, branchId });
  }

  async update(id: string, dto: any, scope: AuthUser) {
    const existing = await this.menuModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Menu item not found');
    assertOwnsBranch(scope, existing as any);
    const safe = { ...dto };
    delete (safe as any).branchId; // immutable post-create
    const item = await this.menuModel
      .findByIdAndUpdate(id, safe, { new: true })
      .select('-imageData -glbData')
      .lean();
    return item!;
  }

  async uploadImage(id: string, file: Express.Multer.File, scope: AuthUser) {
    const existing = await this.menuModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Menu item not found');
    assertOwnsBranch(scope, existing as any);
    const base64 = file.buffer.toString('base64');
    return this.menuModel
      .findByIdAndUpdate(
        id,
        { imageData: base64, imageMime: file.mimetype, imageUrl: `/menu/${id}/image` },
        { new: true },
      )
      .select('-imageData -glbData')
      .lean();
  }

  async uploadGlb(id: string, file: Express.Multer.File, scope: AuthUser) {
    const existing = await this.menuModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Menu item not found');
    assertOwnsBranch(scope, existing as any);
    const base64 = file.buffer.toString('base64');
    return this.menuModel
      .findByIdAndUpdate(
        id,
        { glbData: base64, glbUrl: `/menu/${id}/glb` },
        { new: true },
      )
      .select('-imageData -glbData')
      .lean();
  }

  async rate(id: string, score: number) {
    const item = await this.menuModel.findById(id);
    if (!item) throw new NotFoundException('Menu item not found');
    const newCount = item.ratingCount + 1;
    const newRating = +((item.rating * item.ratingCount + score) / newCount).toFixed(2);
    return this.menuModel
      .findByIdAndUpdate(id, { rating: newRating, ratingCount: newCount }, { new: true })
      .select('-imageData -glbData')
      .lean();
  }

  async delete(id: string, scope: AuthUser) {
    const existing = await this.menuModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Menu item not found');
    assertOwnsBranch(scope, existing as any);
    await this.menuModel.findByIdAndDelete(id);
    return { deleted: true };
  }

  async toggleAvailability(id: string, scope: AuthUser) {
    const item = await this.menuModel.findById(id);
    if (!item) throw new NotFoundException('Menu item not found');
    assertOwnsBranch(scope, item as any);
    item.isAvailable = !item.isAvailable;
    return item.save();
  }
}
