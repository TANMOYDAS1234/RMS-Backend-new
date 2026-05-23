// ─── Sessions Controller ──────────────────────────────────────────────────────

import {
  Controller, Post, Get, Patch, Body, Param, Headers, HttpCode, HttpStatus,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { SessionsService } from './sessions.service';

class ScanQrDto {
  @IsString() tableId: string;
  @IsString() branchId: string;
  @IsString() deviceId: string;
}

// Public — no JWT required (customer QR flow)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // POST /sessions/scan  — QR scan entry point
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  scan(@Body() dto: ScanQrDto) {
    return this.sessionsService.getOrCreate(dto.tableId, dto.branchId, dto.deviceId);
  }

  // GET /sessions/table/:tableId  — poll active session
  @Get('table/:tableId')
  getActive(@Param('tableId') tableId: string) {
    return this.sessionsService.getActiveSession(tableId);
  }

  // PATCH /sessions/:id/refresh  — extend TTL on activity
  @Patch(':id/refresh')
  refresh(@Param('id') id: string) {
    return this.sessionsService.refreshExpiry(id);
  }
}
