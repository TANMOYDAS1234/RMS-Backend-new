import { BadRequestException, Controller, Get, Post, Body, Param, Query, Request, Res, Headers, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
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
  @IsOptional() @IsNumber() @Min(0) tipAmount?: number;
}

class RequestRefundDto {
  @IsString() reason: string;
  @IsOptional() @IsString() reference?: string;
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

  // All three reads now pass req.user so the service can branch-scope.
  // Before this fix a manager (or cashier) could see bills from every
  // branch; daily revenue rolled up the whole chain.
  @Get()
  @Roles('admin', 'manager', 'cashier')
  findAll(@Query('isPaid') isPaid?: string, @Request() req?: any) {
    return this.billingService.findAll(
      isPaid !== undefined ? isPaid === 'true' : undefined,
      req?.user,
    );
  }

  // Cashier added to roles — they need today's revenue on their billing
  // dashboard. Manager + admin already had it.
  @Get('revenue/daily')
  @Roles('admin', 'manager', 'cashier')
  dailyRevenue(@Request() req: any) {
    return this.billingService.getDailyRevenue(req.user);
  }

  /**
   * GST/tax CSV export for accounting. Admin sees every branch, manager
   * is auto-scoped to their own. `from`/`to` are ISO date strings; we
   * default to last 30 days if missing so an unprepared frontend can't
   * 500 the endpoint.
   */
  @Get('reports/gst')
  @Roles('admin', 'manager')
  async gstReport(
    @Query('from') from: string,
    @Query('to') to: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromDate = from ? new Date(from) : defaultFrom;
    const toDate = to ? new Date(to) : now;
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    const csv = await this.billingService.generateGstCsv(
      fromDate,
      toDate,
      req.user,
    );
    const fname = `gst-report-${fromDate.toISOString().slice(0, 10)}-to-${toDate
      .toISOString()
      .slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  }

  @Get('order/:orderId')
  @Roles('admin', 'manager', 'cashier', 'waiter')
  findByOrder(@Param('orderId') orderId: string, @Request() req: any) {
    return this.billingService.findByOrder(orderId, req.user);
  }

  @Post('order/:orderId/generate')
  @Roles('admin', 'manager', 'cashier')
  generate(@Param('orderId') orderId: string, @Body() dto: GenerateBillDto) {
    return this.billingService.generateBill(orderId, dto.discountPercent ?? 0);
  }

  // ── Refund workflow ───────────────────────────────────────────────────────
  //
  // Cashier files the request with a reason; manager (or admin) approves
  // (executes the PSP refund) or denies. The legacy PATCH /admin/billing/:id
  // /refund endpoint still works for admin-only quick refunds.

  @Post(':id/request-refund')
  @Roles('admin', 'manager', 'cashier')
  requestRefund(
    @Param('id') id: string,
    @Body() dto: RequestRefundDto,
    @Request() req: any,
  ) {
    return this.billingService.requestRefund(id, req.user, dto.reason, dto.reference);
  }

  @Post(':id/approve-refund')
  @Roles('admin', 'manager')
  approveRefund(@Param('id') id: string, @Request() req: any) {
    return this.billingService.approveRefund(id, req.user);
  }

  @Post(':id/deny-refund')
  @Roles('admin', 'manager')
  denyRefund(@Param('id') id: string, @Request() req: any) {
    return this.billingService.denyRefund(id, req.user);
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
      dto.tipAmount,
    );
  }
}
