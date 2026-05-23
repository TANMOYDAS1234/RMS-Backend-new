import { Controller, Get, Post, Body, Param, Query, Request, Headers, UseGuards } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsArray, Min, Max } from 'class-validator';
import { BillingService } from './billing.service';
import { PaymentMethod } from './bill.schema';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class GenerateBillDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) discountPercent?: number;
}

class PaymentDto {
  @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
  @IsOptional() @IsArray() splitPayments?: { method: PaymentMethod; amount: number }[];
}

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @Roles('admin', 'manager', 'cashier')
  findAll(@Query('isPaid') isPaid?: string) {
    return this.billingService.findAll(isPaid !== undefined ? isPaid === 'true' : undefined);
  }

  @Get('revenue/daily')
  @Roles('admin', 'manager')
  dailyRevenue() { return this.billingService.getDailyRevenue(); }

  @Get('order/:orderId')
  @Roles('admin', 'manager', 'cashier', 'waiter')
  findByOrder(@Param('orderId') orderId: string) { return this.billingService.findByOrder(orderId); }

  @Post('order/:orderId/generate')
  @Roles('admin', 'manager', 'cashier')
  generate(@Param('orderId') orderId: string, @Body() dto: GenerateBillDto) {
    return this.billingService.generateBill(orderId, dto.discountPercent ?? 0);
  }

  @Post(':id/pay')
  @Roles('admin', 'manager', 'cashier')
  pay(
    @Param('id') id: string,
    @Body() dto: PaymentDto,
    @Request() req: any,
    @Headers('idempotency-key') key: string,
  ) {
    return this.billingService.processPayment(id, req.user._id, dto.paymentMethod, dto.splitPayments, key);
  }
}
