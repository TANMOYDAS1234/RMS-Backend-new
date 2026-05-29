import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('sales')
  getSales(
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.analyticsService.getSalesSummary(f, t);
  }

  @Get('peak-hours')
  getPeakHours(@Query('from') from?: string, @Query('to') to?: string) {
    const f = from ? new Date(from) : undefined;
    const t = to ? new Date(to) : undefined;
    return this.analyticsService.getPeakHours(f, t);
  }

  @Get('table-turnover')
  getTableTurnover(@Query('from') from: string, @Query('to') to: string) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.analyticsService.getTableTurnover(f, t);
  }

  @Get('top-items')
  getTopItems(
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const l = limit ? parseInt(limit, 10) : 10;
    const f = from ? new Date(from) : undefined;
    const t = to ? new Date(to) : undefined;
    return this.analyticsService.getTopItems(l, f, t);
  }

  @Get('staff-performance')
  getStaffPerformance(@Query('from') from: string, @Query('to') to: string) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.analyticsService.getStaffPerformance(f, t);
  }
}
