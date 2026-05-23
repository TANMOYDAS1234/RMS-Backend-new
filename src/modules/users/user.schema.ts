// ─── User Schema ─────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  WAITER = 'waiter',
  CHEF = 'chef',
  CASHIER = 'cashier',
  CUSTOMER = 'customer',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true }) name: string;
  @Prop({ required: true, unique: true, lowercase: true }) email: string;
  @Prop({ required: true, select: false }) password: string;
  @Prop({ enum: UserRole, default: UserRole.WAITER }) role: UserRole;
  @Prop() fcmToken?: string;
  @Prop({ default: true }) isActive: boolean;
  @Prop() photoUrl?: string;
  @Prop({ select: false }) photoData?: string;  // base64
  @Prop({ select: false }) photoMime?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 });
