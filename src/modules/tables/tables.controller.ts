import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { TablesService } from './tables.service';
import { TableStatus } from './table.schema';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateTableDto {
  @IsString() label: string;
  @IsNumber() @Min(1) capacity: number;
}

class UpdateTableStatusDto {
  @IsEnum(TableStatus) status: TableStatus;
  @IsOptional() @IsString() activeOrderId?: string;
}

@Controller('tables')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @Roles('admin', 'manager', 'waiter', 'cashier')
  findAll() { return this.tablesService.findAll(); }

  @Get(':id')
  @Roles('admin', 'manager', 'waiter', 'cashier')
  findOne(@Param('id') id: string) { return this.tablesService.findById(id); }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateTableDto) { return this.tablesService.create(dto); }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'waiter')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTableStatusDto) {
    return this.tablesService.updateStatus(id, dto.status, dto.activeOrderId);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) { return this.tablesService.delete(id); }
}
