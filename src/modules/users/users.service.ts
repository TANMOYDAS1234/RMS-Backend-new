import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument, UserRole } from './user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(dto: { name: string; email: string; password: string; role?: UserRole }) {
    const exists = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (exists) throw new ConflictException('Email already in use');
    const hashed = await bcrypt.hash(dto.password, 10);
    return this.userModel.create({ ...dto, email: dto.email.toLowerCase(), password: hashed });
  }

  async findAll() {
    return this.userModel.find().select('-password').lean();
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id).select('-password').lean();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: Partial<{ name: string; role: UserRole; isActive: boolean; fcmToken: string }>) {
    const user = await this.userModel.findByIdAndUpdate(id, dto, { new: true }).select('-password').lean();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async uploadPhoto(id: string, file: Express.Multer.File) {
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

  async delete(id: string) {
    await this.userModel.findByIdAndDelete(id);
    return { deleted: true };
  }
}
