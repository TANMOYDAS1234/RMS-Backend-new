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
