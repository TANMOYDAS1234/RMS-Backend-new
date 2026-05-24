import {
  Controller, Get, Post, Patch, Body, Param, Request,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ManagerService } from './manager.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrderStatus } from '../orders/order.schema';
import { TableStatus } from '../tables/table.schema';

class ApplyDiscountDto {
  @IsNumber() @Min(0) @Max(100) discountPercent: number;
  @IsString() @IsOptional() reason: string;
}

class OverrideStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
}

class UpdateTableStatusDto {
  @IsEnum(TableStatus) status: TableStatus;
}

class ComplaintDto {
  @IsString() tableLabel: string;
  @IsString() issue: string;
}

class ShortageDto {
  @IsString() note: string;
}

@Controller('manager')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  // ── Operations ─────────────────────────────────────────────────────────────
  @Get('operations')
  getOperations() { return this.managerService.getOperationsSummary(); }

  @Patch('orders/:id/force-close')
  forceClose(@Param('id') id: string, @Request() req: any) {
    return this.managerService.forceCloseOrder(id, req.user._id);
  }

  @Patch('orders/:id/override-status')
  overrideStatus(@Param('id') id: string, @Body() dto: OverrideStatusDto, @Request() req: any) {
    return this.managerService.overrideStatus(id, dto.status, req.user._id);
  }

  // ── Tables ─────────────────────────────────────────────────────────────────
  @Get('tables')
  getTables() { return this.managerService.getTablesWithOccupancy(); }

  @Patch('tables/:id/status')
  updateTableStatus(@Param('id') id: string, @Body() dto: UpdateTableStatusDto) {
    return this.managerService.updateTableStatus(id, dto.status);
  }

  // ── Staff ──────────────────────────────────────────────────────────────────
  @Get('staff')
  getStaff() { return this.managerService.getStaffWithActivity(); }

  // ── Discounts ──────────────────────────────────────────────────────────────
  @Get('discount-requests')
  getDiscountRequests() { return this.managerService.getPendingDiscountRequests(); }

  @Patch('orders/:id/discount')
  applyDiscount(@Param('id') id: string, @Body() dto: ApplyDiscountDto, @Request() req: any) {
    return this.managerService.applyDiscount(id, dto.discountPercent, req.user._id, dto.reason);
  }

  // ── Kitchen ────────────────────────────────────────────────────────────────
  @Get('kitchen')
  getKitchen() { return this.managerService.getKitchenWorkload(); }

  @Patch('orders/:id/prioritize')
  prioritize(@Param('id') id: string, @Request() req: any) {
    return this.managerService.prioritizeOrder(id, req.user._id);
  }

  // ── Inventory ──────────────────────────────────────────────────────────────
  @Get('inventory')
  getInventory() { return this.managerService.getInventoryStatus(); }

  @Post('inventory/:id/report-shortage')
  reportShortage(@Param('id') id: string, @Body() dto: ShortageDto, @Request() req: any) {
    return this.managerService.reportShortage(id, req.user._id, dto.note);
  }

  // ── Reports ────────────────────────────────────────────────────────────────
  @Get('report')
  getReport() { return this.managerService.getOperationalReport(); }

  // ── Customer Service ───────────────────────────────────────────────────────
  @Get('complaints')
  getComplaints() { return this.managerService.getComplaints(); }

  @Post('complaints')
  logComplaint(@Body() dto: ComplaintDto, @Request() req: any) {
    return this.managerService.logComplaint(dto.tableLabel, dto.issue, req.user._id);
  }
}
