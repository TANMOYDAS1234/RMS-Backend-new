import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { MenuItem, MenuItemDocument } from './menu.schema';

@Injectable()
export class MenuService {
  constructor(@InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>) {}

  // ── Public: branch-scoped, available only ──────────────────────────────────
  async findByBranch(branchId: string, category?: string) {
    const filter: any = { branchId, isAvailable: true };
    if (category) filter.category = category;
    return this.menuModel.find(filter).lean();
  }

  // ── Admin: all items for a branch (including unavailable) ──────────────────
  async findByBranchAdmin(branchId: string) {
    return this.menuModel.find({ branchId }).lean();
  }

  async findById(id: string) {
    const item = await this.menuModel.findById(id).lean();
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async create(dto: any) {
    return this.menuModel.create(dto);
  }

  async update(id: string, dto: any) {
    const item = await this.menuModel.findByIdAndUpdate(id, dto, { new: true }).lean();
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async uploadImage(id: string, file: Express.Multer.File) {
    const item = await this.menuModel.findById(id);
    if (!item) throw new NotFoundException('Menu item not found');
    if (item.imageUrl) this._deleteFile(item.imageUrl);
    return this.menuModel.findByIdAndUpdate(
      id, { imageUrl: `/uploads/${file.filename}` }, { new: true },
    ).lean();
  }

  async uploadGlb(id: string, file: Express.Multer.File) {
    const item = await this.menuModel.findById(id);
    if (!item) throw new NotFoundException('Menu item not found');
    if (item.glbUrl) this._deleteFile(item.glbUrl);
    return this.menuModel.findByIdAndUpdate(
      id, { glbUrl: `/uploads/${file.filename}` }, { new: true },
    ).lean();
  }

  async rate(id: string, score: number) {
    const item = await this.menuModel.findById(id);
    if (!item) throw new NotFoundException('Menu item not found');
    const newCount = item.ratingCount + 1;
    const newRating = +((item.rating * item.ratingCount + score) / newCount).toFixed(2);
    return this.menuModel.findByIdAndUpdate(
      id, { rating: newRating, ratingCount: newCount }, { new: true },
    ).lean();
  }

  async delete(id: string) {
    const item = await this.menuModel.findById(id);
    if (item?.imageUrl) this._deleteFile(item.imageUrl);
    if (item?.glbUrl) this._deleteFile(item.glbUrl);
    await this.menuModel.findByIdAndDelete(id);
    return { deleted: true };
  }

  async toggleAvailability(id: string) {
    const item = await this.menuModel.findById(id);
    if (!item) throw new NotFoundException('Menu item not found');
    item.isAvailable = !item.isAvailable;
    return item.save();
  }

  private _deleteFile(urlPath: string) {
    try {
      const filePath = path.join(process.cwd(), 'uploads', path.basename(urlPath));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
}
