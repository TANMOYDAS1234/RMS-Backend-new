// ─── Create Order DTO ────────────────────────────────────────────────────────

import {
  IsString, IsArray, ValidateNested,
  IsNumber, IsOptional, Min, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsString() itemId: string;
  @IsString() name: string;
  @IsNumber() @Min(1) quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsString() notes?: string;
}

export class CreateOrderDto {
  @IsString() tableId: string;
  @IsString() tableLabel: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional() @IsString() notes?: string;
}
