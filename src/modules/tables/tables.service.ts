import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Table, TableDocument, TableStatus } from './table.schema';
import {
  AuthUser,
  assertOwnsBranch,
  resolveBranchIdForCreate,
  scopeFilter,
} from '../../common/scope/branch-scope';

@Injectable()
export class TablesService {
  constructor(@InjectModel(Table.name) private tableModel: Model<TableDocument>) {}

  async findAll(scope?: AuthUser) {
    return this.tableModel.find(scope ? scopeFilter(scope) : {}).lean();
  }

  /**
   * Looked up by id only (no scope check) because internal callers
   * (sessions, orders) need to resolve a table to derive its branchId
   * before they can do an ownership check. Public controller-level checks
   * happen in updateStatus/delete.
   */
  async findById(id: string) {
    const t = await this.tableModel.findById(id).lean();
    if (!t) throw new NotFoundException('Table not found');
    return t;
  }

  async create(dto: { label: string; capacity: number; branchId?: string }, scope: AuthUser) {
    const branchId = resolveBranchIdForCreate(scope, dto.branchId);
    if (!branchId) throw new BadRequestException('branchId is required');
    // Label uniqueness is per-branch now — the compound index on the
    // schema enforces this, but we surface a nicer error here.
    const exists = await this.tableModel.findOne({ branchId, label: dto.label });
    if (exists) throw new ConflictException('Table label already exists in this branch');
    return this.tableModel.create({ ...dto, branchId });
  }

  async updateStatus(id: string, status: TableStatus, activeOrderId: string | undefined, scope: AuthUser) {
    const existing = await this.tableModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Table not found');
    assertOwnsBranch(scope, existing as any);

    const update: any = { status };
    if (activeOrderId !== undefined) update.activeOrderId = activeOrderId;
    if (status === TableStatus.AVAILABLE) update.activeOrderId = null;
    const t = await this.tableModel.findByIdAndUpdate(id, update, { new: true }).lean();
    return t!;
  }

  async delete(id: string, scope: AuthUser) {
    const existing = await this.tableModel.findById(id).lean();
    if (!existing) throw new NotFoundException('Table not found');
    assertOwnsBranch(scope, existing as any);
    await this.tableModel.findByIdAndDelete(id);
    return { deleted: true };
  }
}
