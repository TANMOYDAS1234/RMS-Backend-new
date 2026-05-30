// ─── Orders Controller ───────────────────────────────────────────────────────

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Headers,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // GET /orders/active — staff only
  @Get('active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  getActive(@Request() req: any) {
    return this.ordersService.getActiveOrders(req.user);
  }

  // GET /orders/:id — staff only
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  getById(@Param('id') id: string) {
    return this.ordersService.getById(id);
  }

  // POST /orders — staff-initiated order. Requires JWT; branchId comes from
  // the table (which is now branch-scoped) and is asserted against the
  // caller's branch for non-admins.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'waiter')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateOrderDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.ordersService.createForStaff(dto, req.user, idempotencyKey);
  }

  // POST /orders/public — QR/customer-initiated order. No JWT; the active
  // session vouches for the customer. The session also supplies branchId
  // and tableId so the body can't lie about either. Throttled aggressively
  // because this endpoint is publicly reachable.
  @Post('public')
  @Throttle({ medium: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  createPublic(
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required for public orders.');
    }
    return this.ordersService.createFromSession(dto, idempotencyKey);
  }

  // PATCH /orders/:id/status — staff state-machine transitions
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.ordersService.updateStatus(id, dto, req.user._id, idempotencyKey);
  }

  // PATCH /orders/:id/items/:itemId/progress  (Chef only)
  @Patch(':id/items/:itemId/progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('chef')
  updateProgress(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body('progress') progress: number,
    @Request() req: any,
  ) {
    return this.ordersService.updateItemProgress(orderId, itemId, progress, req.user._id);
  }
}
