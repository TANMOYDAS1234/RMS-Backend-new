import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument, UserRole } from './user.schema';
import { AuthUser, assertOwnsBranch, isAdmin, scopeFilter } from '../../common/scope/branch-scope';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(dto: { name: string; email: string; password: string; role?: UserRole; branchId?: string }) {
    const exists = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (exists) throw new ConflictException('Email already in use');
    const hashed = await bcrypt.hash(dto.password, 10);
    return this.userModel.create({
      ...dto,
      email: dto.email.toLowerCase(),
      password: hashed,
      // Persist branchId as null when unset so the field is always present.
      branchId: dto.branchId ?? null,
    });
  }

  /** Admin sees everyone; manager only sees users in their branch. */
  async findAll(scope: AuthUser) {
    return this.userModel.find(scopeFilter(scope)).select('-password').lean();
  }

  async findById(id: string, scope: AuthUser) {
    const user = await this.userModel.findById(id).select('-password').lean();
    if (!user) throw new NotFoundException('User not found');
    assertOwnsBranch(scope, user as any);
    return user;
  }

  async update(
    id: string,
    dto: Partial<{ name: string; role: UserRole; isActive: boolean; fcmToken: string; branchId: string }>,
    scope: AuthUser,
  ) {
    const existing = await this.userModel.findById(id).select('-password').lean();
    if (!existing) throw new NotFoundException('User not found');
    assertOwnsBranch(scope, existing as any);
    // Manager cannot escalate the target user into admin/manager territory.
    if (!isAdmin(scope) && existing.role && (existing.role === UserRole.ADMIN || existing.role === UserRole.MANAGER)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findByIdAndUpdate(id, dto, { new: true }).select('-password').lean();
    return user!;
  }

  async uploadPhoto(id: string, file: Express.Multer.File, scope: AuthUser) {
    const existing = await this.userModel.findById(id).select('-password').lean();
    if (!existing) throw new NotFoundException('User not found');
    assertOwnsBranch(scope, existing as any);
    const base64 = file.buffer.toString('base64');
    return this.userModel
      .findByIdAndUpdate(
        id,
        { photoUrl: `/users/${id}/photo`, photoData: base64, photoMime: file.mimetype },
        { new: true },
      )
      .select('-password')
      .lean();
  }

  async findByIdWithPhoto(id: string) {
    // Public-ish (called from GET /users/:id/photo) — no scope check here.
    // The image bytes themselves aren't sensitive across branches.
    return this.userModel.findById(id).select('+photoData +photoMime').lean();
  }

  async delete(id: string, scope: AuthUser) {
    const existing = await this.userModel.findById(id).lean();
    if (!existing) throw new NotFoundException('User not found');
    assertOwnsBranch(scope, existing as any);
    if (!isAdmin(scope) && (existing.role === UserRole.ADMIN || existing.role === UserRole.MANAGER)) {
      throw new NotFoundException('User not found');
    }
    await this.userModel.findByIdAndDelete(id);
    return { deleted: true };
  }
}
