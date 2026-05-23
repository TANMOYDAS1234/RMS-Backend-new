// ─── Menu Schema ─────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MenuItemDocument = MenuItem & Document;

@Schema({ _id: false })
class Variant {
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) price: number;
}

@Schema({ _id: false })
class Modifier {
  @Prop({ required: true }) name: string;
  @Prop({ default: 0 }) extraPrice: number;
}

@Schema({ _id: false })
class IngredientRef {
  @Prop() ingredientId: string;
  @Prop({ required: true }) name: string;       // display name e.g. "Tomato"
  @Prop({ default: 0 }) quantity: number;
  @Prop({ default: '' }) unit: string;
  @Prop({ default: false }) isAllergen: boolean; // highlight allergens
}

@Schema({ timestamps: true })
export class MenuItem {
  // ── Branch scope ────────────────────────────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'Branch', required: true, index: true })
  branchId: Types.ObjectId;

  // ── Core ────────────────────────────────────────────────────────────────────
  @Prop({ required: true }) name: string;
  @Prop({ default: '' }) description: string;
  @Prop({ required: true }) category: string;
  @Prop({ required: true, min: 0 }) basePrice: number;
  @Prop({ default: true }) isAvailable: boolean;
  @Prop({ default: false }) isVeg: boolean;
  @Prop({ default: 0 }) prepTimeMinutes: number;

  // ── Media ───────────────────────────────────────────────────────────────────
  @Prop({ type: String, default: null }) imageUrl: string | null;
  @Prop({ type: String, default: null }) imageData: string | null;
  @Prop({ type: String, default: null }) imageMime: string | null;
  @Prop({ type: String, default: null }) glbUrl: string | null;
  @Prop({ type: String, default: null }) glbData: string | null;

  // ── Rich data ───────────────────────────────────────────────────────────────
  @Prop({ type: [String], default: [] }) tags: string[];   // ['spicy','vegan','bestseller']
  @Prop({ type: [IngredientRef], default: [] }) ingredients: IngredientRef[];
  @Prop({ type: [Variant], default: [] }) variants: Variant[];
  @Prop({ type: [Modifier], default: [] }) modifiers: Modifier[];

  // ── Rating (aggregated) ─────────────────────────────────────────────────────
  @Prop({ default: 0, min: 0, max: 5 }) rating: number;
  @Prop({ default: 0 }) ratingCount: number;
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
MenuItemSchema.index({ branchId: 1, category: 1, isAvailable: 1 });
MenuItemSchema.index({ branchId: 1, isAvailable: 1 });
