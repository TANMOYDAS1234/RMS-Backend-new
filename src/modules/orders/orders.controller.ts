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
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // GET /orders/active
  @Get('active')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  getActive() {
    return this.ordersService.getActiveOrders();
  }

  // GET /orders/:id
  @Get(':id')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  getById(@Param('id') id: string) {
    return this.ordersService.getById(id);
  }

  // POST /orders
  @Post()
  @Roles('admin', 'manager', 'waiter', 'customer')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateOrderDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.ordersService.create(dto, req.user.id, idempotencyKey);
  }

  // PATCH /orders/:id/status
  @Patch(':id/status')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.ordersService.updateStatus(id, dto, req.user.id, idempotencyKey);
  }

  // PATCH /orders/:id/items/:itemId/progress  (Chef only)
  @Patch(':id/items/:itemId/progress')
  @Roles('chef')
  updateProgress(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body('progress') progress: number,
    @Request() req: any,
  ) {
    return this.ordersService.updateItemProgress(orderId, itemId, progress, req.user.id);
  }
}
