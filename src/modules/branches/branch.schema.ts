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

  // Minutes after which a confirmed/preparing order is flagged "overdue"
  // on the kitchen display. Tunable per-branch because prep windows
  // differ — fast casual is 8, fine dining is 25, etc.
  @Prop({ default: 15, min: 1, max: 120 }) overdueAfterMinutes: number;

  // Trusts the head chef to add/edit ingredients + set low-stock
  // thresholds on this branch's inventory. Default off so a new branch
  // ships with the standard separation-of-duties (manager places orders,
  // chef only adjusts existing stock). Manager flips it on for small
  // operations / proven chefs. Anything the chef adds while this is on
  // gets pendingReview=true (see Ingredient schema) so the manager can
  // audit cost/threshold numbers later.
  @Prop({ default: false }) chefCanManageInventory: boolean;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);
BranchSchema.index({ slug: 1 });
