import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, Request, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Audit Log ──────────────────────────────────────────────────────────────
  @Get('audit-log')
  getAuditLog(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('action') action?: string,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.adminService.getAuditLog(f, t, action);
  }

  // ── Password Reset ─────────────────────────────────────────────────────────
  @Post('users/:id/reset-password')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @Request() req: any,
  ) {
    return this.adminService.resetPassword(id, dto.newPassword, req.user._id);
  }

  // ── Financial Summary (EOD reconciliation) ─────────────────────────────────
  @Get('financial-summary')
  financialSummary(@Query('date') date?: string) {
    const d = date ? new Date(date) : new Date();
    return this.adminService.getFinancialSummary(d);
  }

  // ── Transaction Log ────────────────────────────────────────────────────────
  @Get('transactions')
  transactions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('isPaid') isPaid?: string,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const t = to ? new Date(to) : new Date();
    const paid = isPaid !== undefined ? isPaid === 'true' : undefined;
    return this.adminService.getTransactions(f, t, paid);
  }

  // ── Refund ─────────────────────────────────────────────────────────────────
  @Patch('billing/:id/refund')
  refund(@Param('id') id: string, @Request() req: any) {
    return this.adminService.processRefund(id, req.user._id);
  }

  // ── Profit Margin ──────────────────────────────────────────────────────────
  @Get('profit-margin')
  profitMargin(@Query('from') from?: string, @Query('to') to?: string) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.adminService.getProfitMargin(f, t);
  }

  // ── Force Close Order ──────────────────────────────────────────────────────
  @Patch('orders/:id/force-close')
  forceClose(@Param('id') id: string, @Request() req: any) {
    return this.adminService.forceCloseOrder(id, req.user._id);
  }

  // ── System Health ──────────────────────────────────────────────────────────
  @Get('system-health')
  systemHealth() {
    return this.adminService.getSystemHealth();
  }
}
