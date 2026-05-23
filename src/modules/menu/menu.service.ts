import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuItem, MenuItemDocument } from './menu.schema';

@Injectable()
export class MenuService {
  constructor(@InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>) {}

  async findAll(category?: string) {
    const filter = category ? { category, isAvailable: true } : {};
    return this.menuModel.find(filter).lean();
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
