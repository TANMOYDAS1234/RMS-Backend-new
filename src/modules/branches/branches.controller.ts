import {
  Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { BranchesService } from './branches.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { isAdmin } from '../../common/scope/branch-scope';

class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsNumber() gstRate?: number;
  @IsOptional() isActive?: boolean;
  @IsOptional() @IsNumber() overdueAfterMinutes?: number;
  // Manager-settable per-branch toggle: when true the head chef can
  // add ingredients + edit thresholds (entries are flagged
  // pendingReview until the manager audits them).
  @IsOptional() @IsBoolean() chefCanManageInventory?: boolean;
}

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  async findAll(@Request() req: any) {
    // Admin sees every branch; manager sees only their own (so the picker
    // and dropdowns don't leak the multi-tenant topology).
    if (isAdmin(req.user)) return this.branchesService.findAll();
    if (!req.user?.branchId) return [];
    const own = await this.branchesService.findById(req.user.branchId);
    return own ? [own] : [];
  }

  // Public — needed by QR web app to check feature flags before showing order UI
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) { return this.branchesService.findBySlug(slug); }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string) { return this.branchesService.findById(id); }

  // Public — QR app polls this to know if ordering is live
  @Get(':id/qr-enabled')
  isQrEnabled(@Param('id') id: string) {
    return this.branchesService.isQrOrderingEnabled(id).then((enabled) => ({ enabled }));
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  create(@Body() dto: { name: string; address: string; slug: string }) {
    return this.branchesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto, @Request() req: any) {
    // Manager can only update their own branch. Admin can touch any.
    // Cross-branch update via a leaked manager token used to be a hole.
    if (!isAdmin(req.user) && req.user.branchId !== id) {
      throw new ForbiddenException('You can only update your own branch.');
    }
    return this.branchesService.update(id, dto);
  }

  @Patch(':id/features')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateFeatures(@Param('id') id: string, @Body() features: any) {
    return this.branchesService.updateFeatures(id, features);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  delete(@Param('id') id: string) { return this.branchesService.delete(id); }
}
