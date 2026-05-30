import { Controller, Get, Post, Body, Param, Query, Request, Headers, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsEnum, IsNumber, IsOptional, IsArray, IsString, Min, Max } from 'class-validator';
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
  // Razorpay sandbox order returns these on a successful checkout;
  // recorded for later reconciliation. NEVER trust the client about
  // whether the payment actually succeeded — a real prod system would
  // call Razorpay's verify-signature server-side. For the sandbox demo
  // we accept the IDs as proof of UI flow completion.
  @IsOptional() @IsString() razorpayPaymentId?: string;
  @IsOptional() @IsString() razorpayOrderId?: string;
  @IsOptional() @IsString() razorpaySignature?: string;
}

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Hand the client the Razorpay sandbox public key. We DO NOT send the
   * secret key. The Flutter Razorpay SDK opens its checkout with this
   * key + the bill amount; the cashier completes the payment in the
   * sandbox UI; on success the SDK returns ids back, which the client
   * POSTs to /billing/:id/pay.
   */
  @Get('razorpay/config')
  @Roles('admin', 'manager', 'cashier')
  razorpayConfig() {
    return {
      keyId: this.config.get<string>('RAZORPAY_KEY_ID') ?? '',
      enabled: !!this.config.get<string>('RAZORPAY_KEY_ID'),
      environment: this.config.get<string>('RAZORPAY_ENV') ?? 'sandbox',
    };
  }

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
    return this.billingService.processPayment(
      id,
      req.user._id,
      dto.paymentMethod,
      dto.splitPayments,
      key,
      {
        razorpayPaymentId: dto.razorpayPaymentId,
        razorpayOrderId: dto.razorpayOrderId,
      },
    );
  }
}
