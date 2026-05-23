import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { IsString, IsNumber, IsOptional, IsBoolean, IsArray, Min, Max } from 'class-validator';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateMenuItemDto {
  @IsString() branchId: string;
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsString() category: string;
  @IsNumber() @Min(0) basePrice: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsBoolean() isVeg?: boolean;
  @IsOptional() @IsNumber() prepTimeMinutes?: number;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsArray() ingredients?: any[];
  @IsOptional() @IsArray() variants?: any[];
  @IsOptional() @IsArray() modifiers?: any[];
}

class RateDto {
  @IsNumber() @Min(1) @Max(5) score: number;
}

const mediaStorage = (prefix: string) => diskStorage({
  destination: './uploads',
  filename: (_, file, cb) => cb(null, `${prefix}-${Date.now()}${extname(file.originalname)}`),
});

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // ── Public: branch-scoped menu for QR customers ───────────────────────────
  @Get('branch/:branchId')
  findByBranch(
    @Param('branchId') branchId: string,
    @Query('category') category?: string,
  ) { return this.menuService.findByBranch(branchId, category); }

  // ── Admin: all items for a branch (incl. unavailable) ────────────────────
  @Get('branch/:branchId/admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  findByBranchAdmin(@Param('branchId') branchId: string) {
    return this.menuService.findByBranchAdmin(branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.menuService.findById(id); }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  create(@Body() dto: CreateMenuItemDto) { return this.menuService.create(dto); }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: Partial<CreateMenuItemDto>) {
    return this.menuService.update(id, dto);
  }

  // ── Image upload ──────────────────────────────────────────────────────────
  @Post(':id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @UseInterceptors(FileInterceptor('image', {
    storage: mediaStorage('menu-img'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      if (!file.mimetype.match(/^image\//)) return cb(new BadRequestException('Images only'), false);
      cb(null, true);
    },
  }))
  uploadImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.menuService.uploadImage(id, file);
  }

  // ── GLB (3D model) upload ─────────────────────────────────────────────────
  @Post(':id/glb')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @UseInterceptors(FileInterceptor('glb', {
    storage: mediaStorage('menu-glb'),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for 3D models
    fileFilter: (_, file, cb) => {
      const ok = file.originalname.toLowerCase().endsWith('.glb') ||
                 file.mimetype === 'model/gltf-binary' ||
                 file.mimetype === 'application/octet-stream';
      if (!ok) return cb(new BadRequestException('GLB files only'), false);
      cb(null, true);
    },
  }))
  uploadGlb(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.menuService.uploadGlb(id, file);
  }

  // ── Customer rating ───────────────────────────────────────────────────────
  @Post(':id/rate')
  rate(@Param('id') id: string, @Body() dto: RateDto) {
    return this.menuService.rate(id, dto.score);
  }

  @Patch(':id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'chef')
  toggle(@Param('id') id: string) { return this.menuService.toggleAvailability(id); }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  delete(@Param('id') id: string) { return this.menuService.delete(id); }
}
