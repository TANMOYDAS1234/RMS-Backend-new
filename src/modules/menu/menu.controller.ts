import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, IsBoolean, Min, IsArray } from 'class-validator';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateMenuItemDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsString() category: string;
  @IsNumber() @Min(0) basePrice: number;
  @IsOptional() @IsArray() variants?: any[];
  @IsOptional() @IsArray() modifiers?: any[];
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsNumber() prepTimeMinutes?: number;
}

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // Public — QR customers browse menu without auth
  @Get()
  findAll(@Query('category') category?: string) { return this.menuService.findAll(category); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.menuService.findById(id); }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateMenuItemDto) { return this.menuService.create(dto); }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: Partial<CreateMenuItemDto>) { return this.menuService.update(id, dto); }

  @Patch(':id/toggle')
  @Roles('admin', 'manager', 'chef')
  toggle(@Param('id') id: string) { return this.menuService.toggleAvailability(id); }

  @Delete(':id')
  @Roles('admin', 'manager')
  delete(@Param('id') id: string) { return this.menuService.delete(id); }
}
