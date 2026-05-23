// ─── Auth Service ─────────────────────────────────────────────────────────────

import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users/user.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase(), isActive: true })
      .select('+password');

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user._id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: user._id, name: user.name, email: user.email, role: user.role, photoUrl: user.photoUrl },
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
}
