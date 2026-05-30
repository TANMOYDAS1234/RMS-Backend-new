import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CashDrawerService } from './cash-drawer.service';
import { ShiftStatus } from './cash-drawer.schema';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class OpenShiftDto {
  @IsNumber() @Min(0) openingBalance: number;
  @IsOptional() @IsString() cashierName?: string;
}

class CloseShiftDto {
  @IsNumber() @Min(0) closingBalance: number;
  @IsOptional() @IsString() note?: string;
}

@Controller('cash-drawer')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashDrawerController {
  constructor(private readonly cashDrawerService: CashDrawerService) {}

  // Cashier starts a shift.
  @Post('open')
  @Roles('cashier', 'manager', 'admin')
  @HttpCode(HttpStatus.CREATED)
  open(@Body() dto: OpenShiftDto, @Request() req: any) {
    return this.cashDrawerService.open(dto, req.user);
  }

  // Caller's currently-open shift (or null).
  @Get('current')
  @Roles('cashier', 'manager', 'admin')
  current(@Request() req: any) {
    return this.cashDrawerService.current(req.user);
  }

  // Close my open shift.
  @Post(':id/close')
  @Roles('cashier', 'manager', 'admin')
  close(@Param('id') id: string, @Body() dto: CloseShiftDto, @Request() req: any) {
    return this.cashDrawerService.close(id, dto, req.user);
  }

  // Branch audit — managers + admins.
  @Get()
  @Roles('manager', 'admin')
  list(
    @Request() req: any,
    @Query('status') status?: ShiftStatus,
    @Query('limit') limit?: string,
  ) {
    return this.cashDrawerService.list(req.user, status, limit ? parseInt(limit, 10) : 50);
  }
}
