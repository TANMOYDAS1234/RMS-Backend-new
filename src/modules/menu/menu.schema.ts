// ─── Menu Schema ─────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

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

@Schema({ timestamps: true })
export class MenuItem {
  @Prop({ required: true }) name: string;
  @Prop() description?: string;
  @Prop({ required: true }) category: string;
  @Prop({ required: true, min: 0 }) basePrice: number;
  @Prop({ type: [Variant], default: [] }) variants: Variant[];
  @Prop({ type: [Modifier], default: [] }) modifiers: Modifier[];
  @Prop({ default: true }) isAvailable: boolean;
  @Prop() imageUrl?: string;
  @Prop({ default: 0 }) prepTimeMinutes: number;

  // Inventory link for auto-deduction
  @Prop({ type: [{ ingredientId: String, quantity: Number, unit: String }], default: [] })
  ingredients: { ingredientId: string; quantity: number; unit: string }[];
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
MenuItemSchema.index({ category: 1, isAvailable: 1 });
