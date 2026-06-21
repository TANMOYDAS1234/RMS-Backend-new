// ─── Audit Controller ─────────────────────────────────────────────────────────
// Read-only endpoint for the admin / manager UI. Filter params mirror the
// AuditQuery shape; scope is enforced inside AuditService via scopeFilter
// so a manager request can never widen past their branch.

import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(
    @Request() req: any,
    @Query('type') type?: string,
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.query(req.user, {
      type,
      actorId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      branchId,
      skip: skip ? parseInt(skip, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }
}
