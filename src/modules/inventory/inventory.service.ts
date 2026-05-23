import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ingredient, IngredientDocument } from './ingredient.schema';

@Injectable()
export class InventoryService {
  constructor(@InjectModel(Ingredient.name) private ingredientModel: Model<IngredientDocument>) {}

  async findAll() { return this.ingredientModel.find().lean(); }

  async findLowStock() {
    return this.ingredientModel.find({ $expr: { $lte: ['$currentStock', '$lowStockThreshold'] } }).lean();
  }

  async findById(id: string) {
    const item = await this.ingredientModel.findById(id).lean();
    if (!item) throw new NotFoundException('Ingredient not found');
    return item;
  }

  async create(dto: { name: string; unit: string; currentStock: number; lowStockThreshold: number; costPerUnit?: number }) {
    return this.ingredientModel.create(dto);
  }

  async adjustStock(id: string, delta: number, reason: string, by: string) {
    const item = await this.ingredientModel.findById(id);
    if (!item) throw new NotFoundException('Ingredient not found');
    item.currentStock = Math.max(0, item.currentStock + delta);
    item.stockLog.push({ delta, reason, by, at: new Date() });
    return item.save();
  }

  async update(id: string, dto: any) {
    const item = await this.ingredientModel.findByIdAndUpdate(id, dto, { new: true }).lean();
    if (!item) throw new NotFoundException('Ingredient not found');
    return item;
  }

  async delete(id: string) {
    await this.ingredientModel.findByIdAndDelete(id);
    return { deleted: true };
  }
}
