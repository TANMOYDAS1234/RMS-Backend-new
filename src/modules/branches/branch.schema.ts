// ─── Branch / Feature-Toggle Schema ──────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BranchDocument = Branch & Document;

@Schema({ _id: false })
class FeatureToggles {
  @Prop({ default: true })  qrOrdering: boolean;
  @Prop({ default: true })  onlinePayment: boolean;
  @Prop({ default: true })  loyaltySystem: boolean;
  @Prop({ default: true })  tableReservations: boolean;
  // Time-based activation: null = always active
  @Prop({ type: String, default: null }) qrOrderingActiveFrom: string | null; // 'HH:mm'
  @Prop({ type: String, default: null }) qrOrderingActiveTo: string | null;   // 'HH:mm'
}

@Schema({ timestamps: true })
export class Branch {
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) address: string;
  @Prop({ required: true, unique: true }) slug: string; // used in QR URL
  @Prop({ default: true }) isActive: boolean;
  @Prop({ type: FeatureToggles, default: () => ({}) }) features: FeatureToggles;
  @Prop({ default: 0.18 }) gstRate: number;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);
BranchSchema.index({ slug: 1 });
