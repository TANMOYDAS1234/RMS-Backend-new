import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { BranchesService } from './branches.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsNumber() gstRate?: number;
  @IsOptional() isActive?: boolean;
}

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

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
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

  // Public — QR app polls this to know if ordering is live
  @Get(':id/qr-enabled')
  isQrEnabled(@Param('id') id: string) {
    return this.branchesService.isQrOrderingEnabled(id).then((enabled) => ({ enabled }));
  }
}
