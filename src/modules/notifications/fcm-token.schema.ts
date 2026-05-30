// ─── FCM Token Schema ────────────────────────────────────────────────────────
//
// One row per (userId, deviceId). The same user logged in on three devices
// gets three tokens — push fanout sends to every active token for the user.
// Replaces the single `fcmToken?` field on User which only supported one
// device at a time.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FcmTokenDocument = FcmToken & Document;

export enum DevicePlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
}

@Schema({ timestamps: true })
export class FcmToken {
  // Owner. Indexed for the per-user fanout query.
  @Prop({ required: true, index: true }) userId: string;
  // Branch denormalized from the user at write-time. Lets the
  // NotificationsService filter recipients by branch without a $lookup.
  @Prop() branchId?: string;
  // Role denormalized similarly — push fanouts target role:* most often.
  @Prop() role?: string;
  // Stable per-install id from the client. Two devices for the same user
  // are distinguished by this.
  @Prop({ required: true }) deviceId: string;
  @Prop({ enum: DevicePlatform, default: DevicePlatform.ANDROID }) platform: DevicePlatform;
  // FCM registration token. Rotates whenever the SDK refreshes it.
  @Prop({ required: true }) token: string;
  // Last time we saw a heartbeat from this device. Old rows can be GCed.
  @Prop({ default: () => new Date() }) lastSeenAt: Date;
  // Disable without deleting so we keep history for audit/debug.
  @Prop({ default: true }) isActive: boolean;
}

export const FcmTokenSchema = SchemaFactory.createForClass(FcmToken);
// (userId, deviceId) is the natural key — upsert on this so logging in a
// new account on a phone replaces the previous account's row.
FcmTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
FcmTokenSchema.index({ role: 1, branchId: 1, isActive: 1 });
