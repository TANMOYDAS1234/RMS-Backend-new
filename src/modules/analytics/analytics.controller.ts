import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

// Every method now passes req.user into the service so managers get
// branch-scoped aggregates. Without this they'd see chain-wide totals
// (other branches' revenue rolled into theirs, other branches' staff
// in the top-performers list) — the analytics correctness fix.
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('sales')
  getSales(
    @Query('from') from: string,
    @Query('to') to: string,
    @Request() req: any,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.analyticsService.getSalesSummary(f, t, req.user);
  }

  @Get('peak-hours')
  getPeakHours(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req: any,
  ) {
    const f = from ? new Date(from) : undefined;
    const t = to ? new Date(to) : undefined;
    return this.analyticsService.getPeakHours(f, t, req.user);
  }

  @Get('table-turnover')
  getTableTurnover(
    @Query('from') from: string,
    @Query('to') to: string,
    @Request() req: any,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.analyticsService.getTableTurnover(f, t, req.user);
  }

  @Get('top-items')
  getTopItems(
    @Query('limit') limit: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req: any,
  ) {
    const l = limit ? parseInt(limit, 10) : 10;
    const f = from ? new Date(from) : undefined;
    const t = to ? new Date(to) : undefined;
    return this.analyticsService.getTopItems(l, f, t, req.user);
  }

  @Get('staff-performance')
  getStaffPerformance(
    @Query('from') from: string,
    @Query('to') to: string,
    @Request() req: any,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.analyticsService.getStaffPerformance(f, t, req.user);
  }
}
