import {
  Controller, Get, Post, Patch, Body, Param, Request,
  UseGuards, NotFoundException,
} from '@nestjs/common';
import { IsEnum, IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ManagerService } from './manager.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TableStatus } from '../tables/table.schema';

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

  // ── Single order-action endpoint — avoids :id/:suffix param collision ──────
  // Handles: force-close | override-status | discount | prioritize
  @Patch('order-action/:action/:id')
  orderAction(
    @Param('action') action: string,
    @Param('id') id: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    switch (action) {
      case 'force-close':
        return this.managerService.forceCloseOrder(id, req.user._id);
      case 'override-status':
        return this.managerService.overrideStatus(id, body.status, req.user._id);
      case 'discount':
        return this.managerService.applyDiscount(
          id,
          Number(body.discountPercent ?? 0),
          req.user._id,
          body.reason ?? 'Manager discount',
        );
      case 'prioritize':
        return this.managerService.prioritizeOrder(id, req.user._id);
      default:
        throw new NotFoundException(`Unknown action: ${action}`);
    }
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

  // ── Kitchen ────────────────────────────────────────────────────────────────
  @Get('kitchen')
  getKitchen() { return this.managerService.getKitchenWorkload(); }

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
