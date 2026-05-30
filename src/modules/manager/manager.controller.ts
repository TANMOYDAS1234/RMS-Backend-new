import {
  Controller, Get, Post, Patch, Body, Param, Query, Request,
  UseGuards, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { IsEnum, IsString, IsNumber, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ManagerService } from './manager.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TableStatus } from '../tables/table.schema';
import { OrderStatus } from '../orders/order.schema';
import { ManagerActionType } from './manager-action-log.schema';

class UpdateTableStatusDto {
  @IsEnum(TableStatus) status: TableStatus;
}

class ComplaintDto {
  @IsString() tableLabel: string;
  @IsString() issue: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() severity?: string;
}

class ResolveComplaintDto {
  @IsString() orderId: string;
  @IsString() complaintId: string;
  @IsString() resolution: string;
}

class ShortageDto {
  @IsString() note: string;
}

class OrderActionDto {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) discountPercent?: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

@Controller('manager')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  // ── Operations ─────────────────────────────────────────────────────────────
  @Get('operations')
  getOperations(@Request() req: any) {
    return this.managerService.getOperationsSummary(req.user);
  }

  // ── Single order-action endpoint — avoids :id/:suffix param collision ──────
  // Handles: force-close | override-status | discount | prioritize
  @Patch('order-action/:action/:id')
  orderAction(
    @Param('action') action: string,
    @Param('id') id: string,
    @Body() body: OrderActionDto,
    @Request() req: any,
  ) {
    switch (action) {
      case 'force-close':
        return this.managerService.forceCloseOrder(id, req.user._id, req.user, body.expectedVersion);
      case 'override-status':
        if (!body.status) throw new BadRequestException('status is required for override-status');
        return this.managerService.overrideStatus(id, body.status, req.user._id, req.user, body.expectedVersion);
      case 'discount':
        if (body.discountPercent === undefined) {
          throw new BadRequestException('discountPercent is required for discount');
        }
        return this.managerService.applyDiscount(
          id,
          body.discountPercent,
          req.user._id,
          body.reason ?? 'Manager discount',
          req.user,
          body.expectedVersion,
        );
      case 'prioritize':
        return this.managerService.prioritizeOrder(id, req.user._id, req.user, body.expectedVersion);
      default:
        throw new NotFoundException(`Unknown action: ${action}`);
    }
  }

  // ── Tables ─────────────────────────────────────────────────────────────────
  @Get('tables')
  getTables(@Request() req: any) {
    return this.managerService.getTablesWithOccupancy(req.user);
  }

  @Patch('tables/:id/status')
  updateTableStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTableStatusDto,
    @Request() req: any,
  ) {
    return this.managerService.updateTableStatus(id, dto.status, req.user?._id, req.user);
  }

  // ── Staff ──────────────────────────────────────────────────────────────────
  @Get('staff')
  getStaff(@Request() req: any) {
    return this.managerService.getStaffWithActivity(req.user);
  }

  // ── Discounts ──────────────────────────────────────────────────────────────
  @Get('discount-requests')
  getDiscountRequests(@Request() req: any) {
    return this.managerService.getPendingDiscountRequests(req.user);
  }

  // ── Kitchen ────────────────────────────────────────────────────────────────
  @Get('kitchen')
  getKitchen(@Request() req: any) {
    return this.managerService.getKitchenWorkload(req.user);
  }

  // ── Inventory ──────────────────────────────────────────────────────────────
  @Get('inventory')
  getInventory(@Request() req: any) {
    return this.managerService.getInventoryStatus(req.user);
  }

  @Post('inventory/:id/report-shortage')
  reportShortage(@Param('id') id: string, @Body() dto: ShortageDto, @Request() req: any) {
    return this.managerService.reportShortage(id, req.user._id, dto.note, req.user);
  }

  // ── Reports ────────────────────────────────────────────────────────────────
  @Get('report')
  getReport(@Request() req: any) {
    return this.managerService.getOperationalReport(req.user);
  }

  // ── Customer Service ───────────────────────────────────────────────────────
  @Get('complaints')
  getComplaints(@Request() req: any) {
    return this.managerService.getComplaints(req.user);
  }

  @Post('complaints')
  logComplaint(@Body() dto: ComplaintDto, @Request() req: any) {
    return this.managerService.logComplaint(
      dto.tableLabel,
      dto.issue,
      req.user._id,
      req.user,
      dto.category,
      dto.severity,
    );
  }

  @Patch('complaints/resolve')
  resolveComplaint(@Body() dto: ResolveComplaintDto, @Request() req: any) {
    return this.managerService.resolveComplaint(dto.orderId, dto.complaintId, req.user._id, dto.resolution, req.user);
  }

  // ── Manager Action Log (durable audit trail) ───────────────────────────────
  @Get('action-log')
  listActions(
    @Query('managerId') managerId?: string,
    @Query('action') action?: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    const s = skip ? parseInt(skip, 10) : 0;
    const l = limit ? parseInt(limit, 10) : 100;
    const validAction =
      action && (Object.values(ManagerActionType) as string[]).includes(action)
        ? (action as ManagerActionType)
        : undefined;
    return this.managerService.listActions(managerId, validAction, s, l);
  }
}
