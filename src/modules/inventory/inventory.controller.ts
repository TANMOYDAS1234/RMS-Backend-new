import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateIngredientDto {
  @IsString() name: string;
  @IsString() unit: string;
  @IsNumber() @Min(0) currentStock: number;
  @IsNumber() @Min(0) lowStockThreshold: number;
  @IsOptional() @IsNumber() costPerUnit?: number;
}

class AdjustStockDto {
  @IsNumber() delta: number;
  @IsString() reason: string;
}

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles('admin', 'manager', 'chef')
  findAll() { return this.inventoryService.findAll(); }

  @Get('low-stock')
  @Roles('admin', 'manager', 'chef')
  lowStock() { return this.inventoryService.findLowStock(); }

  @Get(':id')
  @Roles('admin', 'manager', 'chef')
  findOne(@Param('id') id: string) { return this.inventoryService.findById(id); }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateIngredientDto) { return this.inventoryService.create(dto); }

  @Patch(':id/adjust')
  @Roles('admin', 'manager', 'chef')
  adjust(@Param('id') id: string, @Body() dto: AdjustStockDto, @Request() req: any) {
    return this.inventoryService.adjustStock(id, dto.delta, dto.reason, req.user._id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: Partial<CreateIngredientDto>) {
    return this.inventoryService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) { return this.inventoryService.delete(id); }
}
