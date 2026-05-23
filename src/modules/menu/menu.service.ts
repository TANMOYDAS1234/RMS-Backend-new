import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuItem, MenuItemDocument } from './menu.schema';

@Injectable()
export class MenuService {
  constructor(@InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>) {}

  async findByBranch(branchId: string, category?: string) {
    const filter: any = { branchId, isAvailable: true };
    if (category) filter.category = category;
    return this.menuModel.find(filter).select('-imageData -glbData').lean();
  }

  async findByBranchAdmin(branchId: string) {
    return this.menuModel.find({ branchId }).select('-imageData -glbData').lean();
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
    const item = await this.menuModel
      .findByIdAndUpdate(id, dto, { new: true })
      .select('-imageData -glbData')
      .lean();
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async uploadImage(id: string, file: Express.Multer.File) {
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

  async uploadGlb(id: string, file: Express.Multer.File) {
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

  async delete(id: string) {
    await this.menuModel.findByIdAndDelete(id);
    return { deleted: true };
  }

  async toggleAvailability(id: string) {
    const item = await this.menuModel.findById(id);
    if (!item) throw new NotFoundException('Menu item not found');
    item.isAvailable = !item.isAvailable;
    return item.save();
  }
}
