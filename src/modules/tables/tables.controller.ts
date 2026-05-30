import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { TablesService } from './tables.service';
import { TableStatus } from './table.schema';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateTableDto {
  @IsString() label: string;
  @IsNumber() @Min(1) capacity: number;
  // Admin: optional explicit branch. Manager: forced to own branch.
  @IsOptional() @IsString() branchId?: string;
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
  findAll(@Request() req: any) { return this.tablesService.findAll(req.user); }

  @Get(':id')
  @Roles('admin', 'manager', 'waiter', 'cashier')
  findOne(@Param('id') id: string) { return this.tablesService.findById(id); }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateTableDto, @Request() req: any) {
    return this.tablesService.create(dto, req.user);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'waiter')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTableStatusDto, @Request() req: any) {
    return this.tablesService.updateStatus(id, dto.status, dto.activeOrderId, req.user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  delete(@Param('id') id: string, @Request() req: any) {
    return this.tablesService.delete(id, req.user);
  }
}
