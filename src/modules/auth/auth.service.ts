// ─── Auth Service ─────────────────────────────────────────────────────────────

import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users/user.schema';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/audit-log.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private audit: AuditService,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.toLowerCase();
    const user = await this.userModel
      .findOne({ email: normalizedEmail, isActive: true })
      .select('+password');

    if (!user || !(await bcrypt.compare(password, user.password))) {
      // Record the attempt so a brute-force pattern is visible in the
      // audit feed. actorId stays null when we never resolved a user
      // (wrong email) or when the password didn't match.
      await this.audit.record({
        type: AuditEventType.AUTH_FAILED,
        actorId: user ? user._id.toString() : null,
        actorEmail: normalizedEmail,
        actorRole: user ? user.role : null,
        branchId: user?.branchId ?? null,
        meta: { reason: user ? 'bad_password' : 'unknown_email' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // branchId is part of the payload so the WS gateway can authorize
    // room joins without hitting Mongo on every handshake.
    const payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
      branchId: user.branchId ?? null,
    };
    await this.audit.record({
      type: AuditEventType.AUTH_LOGIN,
      actorId: user._id.toString(),
      actorEmail: user.email,
      actorRole: user.role,
      branchId: user.branchId ?? null,
    });
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        photoUrl: user.photoUrl,
        branchId: user.branchId ?? null,
        // Mongoose `timestamps: true` sets this; clients use it as the
        // cache-buster query param when displaying the avatar.
        updatedAt: (user as any).updatedAt,
      },
    };
  }

  async getMe(userId: string) {
    const user = await this.userModel.findById(userId).select('-password').lean();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: { name?: string; email?: string; password?: string }) {
    const update: any = {};
    if (dto.name) update.name = dto.name.trim();
    if (dto.email) update.email = dto.email.toLowerCase().trim();
    if (dto.password) update.password = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel
      .findByIdAndUpdate(userId, update, { new: true })
      .select('-password')
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async validateToken(payload: any) {
    return this.userModel.findById(payload.sub).lean();
  }

  /** Record a logout event. JWTs are stateless so there's nothing to
   * revoke server-side — this is purely for the audit trail. */
  async logout(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    await this.audit.record({
      type: AuditEventType.AUTH_LOGOUT,
      actorId: userId,
      actorEmail: user?.email ?? null,
      actorRole: user?.role ?? null,
      branchId: user?.branchId ?? null,
    });
    return { ok: true };
  }
}
