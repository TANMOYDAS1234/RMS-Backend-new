// ─── Update Status DTO ───────────────────────────────────────────────────────

import { IsEnum, IsNumber, Min } from 'class-validator';
import { OrderStatus } from '../order.schema';

export class UpdateStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
  @IsNumber() @Min(1) version: number;
}
