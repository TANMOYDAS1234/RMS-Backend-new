import {
  Controller, Get, Post, Patch, Body, Param, UseGuards,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  findAll() { return this.branchesService.findAll(); }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string) { return this.branchesService.findById(id); }

  // Public — needed by QR web app to check feature flags before showing order UI
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) { return this.branchesService.findBySlug(slug); }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  create(@Body() dto: { name: string; address: string; slug: string }) {
    return this.branchesService.create(dto);
  }

  @Patch(':id/features')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateFeatures(@Param('id') id: string, @Body() features: any) {
    return this.branchesService.updateFeatures(id, features);
  }

  // Public — QR app polls this to know if ordering is live
  @Get(':id/qr-enabled')
  isQrEnabled(@Param('id') id: string) {
    return this.branchesService.isQrOrderingEnabled(id).then((enabled) => ({ enabled }));
  }
}
