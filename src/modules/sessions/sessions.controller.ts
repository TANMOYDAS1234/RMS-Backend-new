// ─── Sessions Controller ──────────────────────────────────────────────────────

import {
  Controller, Post, Get, Patch, Body, Param, Query, Request, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class ScanQrDto {
  @IsString() tableId: string;
  @IsString() branchId: string;
  @IsString() deviceId: string;
  /** How many people in this party. Omit on the first call — the server
   * will respond with a `needsPartySize: true` envelope so the client
   * can show "How many of you?" before retrying with the chosen size. */
  @IsOptional() @IsInt() @Min(1) @Max(99) partySize?: number;
}

class CallWaiterDto {
  @IsOptional() @IsString() reason?: string;
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
    return this.sessionsService.getOrCreate(
      dto.tableId,
      dto.branchId,
      dto.deviceId,
      dto.partySize,
    );
  }

  // GET /sessions/table/:tableId  — poll active session (singular, for
  // back-compat with older clients). Multi-party clients should call
  // /sessions/table/:tableId/capacity instead.
  @Get('table/:tableId')
  getActive(@Param('tableId') tableId: string) {
    return this.sessionsService.getActiveSession(tableId);
  }

  // GET /sessions/table/:tableId/capacity
  // How many seats are free + what parties are currently seated. Public:
  // the customer app uses it when showing "Joining a busy table" before
  // the party-size picker. Lightweight enough to be poll-friendly.
  @Get('table/:tableId/capacity')
  capacity(@Param('tableId') tableId: string) {
    return this.sessionsService.getCapacity(tableId);
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

  // POST /sessions/:id/call-waiter — customer taps "Call waiter" from QR
  // ordering screen. Public, throttled hard because it's a public push
  // trigger. Service dedups so a customer mashing the button doesn't
  // wake every waiter twice.
  @Post(':id/call-waiter')
  @Throttle({ short: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  callWaiter(@Param('id') id: string, @Body() dto: CallWaiterDto) {
    return this.sessionsService.callWaiter(id, dto.reason);
  }

  // GET /sessions/help-requests?branchId=...
  // Waiter inbox. Returns every open (unresolved) help request across
  // active sessions in the caller's branch.
  @Get('help-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'waiter')
  listHelpRequests(@Query('branchId') branchId: string, @Request() req: any) {
    // Manager/waiter can only ever see their own branch; admin may pass
    // any branchId. We default to the caller's own when omitted.
    const target = branchId || req.user?.branchId;
    if (!target) return [];
    return this.sessionsService.listHelpRequests(target);
  }

  // PATCH /sessions/:id/help/:helpId/resolve
  @Patch(':id/help/:helpId/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'waiter')
  resolveHelp(
    @Param('id') id: string,
    @Param('helpId') helpId: string,
    @Request() req: any,
  ) {
    return this.sessionsService.resolveHelpRequest(id, helpId, req.user._id);
  }
}
