// ─── Sessions Controller ──────────────────────────────────────────────────────

import {
  Controller, Post, Get, Patch, Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { SessionsService } from './sessions.service';

class ScanQrDto {
  @IsString() tableId: string;
  @IsString() branchId: string;
  @IsString() deviceId: string;
}

// Public — no JWT required (customer QR flow). Each endpoint is throttled
// independently because they're publicly reachable.
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // POST /sessions/scan  — QR scan entry point. Tighter throttle: scanning
  // a table 30 times in a minute is almost certainly a bot.
  @Post('scan')
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  scan(@Body() dto: ScanQrDto) {
    return this.sessionsService.getOrCreate(dto.tableId, dto.branchId, dto.deviceId);
  }

  // GET /sessions/table/:tableId  — poll active session
  @Get('table/:tableId')
  getActive(@Param('tableId') tableId: string) {
    return this.sessionsService.getActiveSession(tableId);
  }

  // GET /sessions/:id/bill  — public, read-only aggregate of all orders
  // attached to this session. Customer uses this to see their running tab
  // before staff prints the final bill. Uses /sessions/:id/bill rather
  // than /billing because /billing requires staff auth.
  @Get(':id/bill')
  bill(@Param('id') id: string) {
    return this.sessionsService.getSessionBill(id);
  }

  // PATCH /sessions/:id/refresh  — extend TTL on activity
  @Patch(':id/refresh')
  refresh(@Param('id') id: string) {
    return this.sessionsService.refreshExpiry(id);
  }
}
