// ─── Inventory Schema ────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IngredientDocument = Ingredient & Document;

@Schema({ timestamps: true })
export class Ingredient {
  // Per-branch ownership. Required so multi-tenant scoping cannot be
  // bypassed by omitting the field on creation. Use `default: null` only
  // for the backfill migration; new docs MUST come with a real branchId.
  @Prop({ required: true, index: true }) branchId: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) unit: string; // kg, litre, piece
  @Prop({ required: true, min: 0 }) currentStock: number;
  @Prop({ required: true, min: 0 }) lowStockThreshold: number;
  @Prop({ default: 0 }) costPerUnit: number;

  // Set to true when a chef adds the ingredient under
  // branch.chefCanManageInventory. Manager sees a "needs review" badge
  // and clears it (POST /inventory/:id/approve) once they verify the
  // cost + threshold. Pure audit trail — doesn't block stock adjustments
  // in the meantime so the chef can keep working.
  @Prop({ default: false }) pendingReview: boolean;

  // Audit trail for stock changes
  @Prop({
    type: [{ delta: Number, reason: String, by: String, at: Date }],
    default: [],
  })
  stockLog: { delta: number; reason: string; by: string; at: Date }[];
}

export const IngredientSchema = SchemaFactory.createForClass(Ingredient);
IngredientSchema.index({ currentStock: 1 });
// Same ingredient name can exist in different branches; collision only
// matters within a branch.
IngredientSchema.index({ branchId: 1, name: 1 }, { unique: true });
