import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Table, TableDocument, TableStatus } from './table.schema';

@Injectable()
export class TablesService {
  constructor(@InjectModel(Table.name) private tableModel: Model<TableDocument>) {}

  async findAll() { return this.tableModel.find().lean(); }

  async findById(id: string) {
    const t = await this.tableModel.findById(id).lean();
    if (!t) throw new NotFoundException('Table not found');
    return t;
  }

  async create(dto: { label: string; capacity: number }) {
    const exists = await this.tableModel.findOne({ label: dto.label });
    if (exists) throw new ConflictException('Table label already exists');
    return this.tableModel.create(dto);
  }

  async updateStatus(id: string, status: TableStatus, activeOrderId?: string) {
    const update: any = { status };
    if (activeOrderId !== undefined) update.activeOrderId = activeOrderId;
    if (status === TableStatus.AVAILABLE) update.activeOrderId = null;
    const t = await this.tableModel.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!t) throw new NotFoundException('Table not found');
    return t;
  }

  async delete(id: string) {
    await this.tableModel.findByIdAndDelete(id);
    return { deleted: true };
  }
}
