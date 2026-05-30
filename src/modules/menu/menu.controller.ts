import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Request,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
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

const mediaStorage = () => memoryStorage();

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // ── Public: branch-scoped menu for QR customers ───────────────────────────
  @Get('branch/:branchId')
  findByBranch(
    @Param('branchId') branchId: string,
    @Query('category') category?: string,
  ) { return this.menuService.findByBranch(branchId, category); }

  // ── Admin/Manager: all items for a branch (incl. unavailable) ────────────
  @Get('branch/:branchId/admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  findByBranchAdmin(@Param('branchId') branchId: string, @Request() req: any) {
    return this.menuService.findByBranchAdmin(branchId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.menuService.findById(id); }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  create(@Body() dto: CreateMenuItemDto, @Request() req: any) {
    return this.menuService.create(dto, req.user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: Partial<CreateMenuItemDto>, @Request() req: any) {
    return this.menuService.update(id, dto, req.user);
  }

  // ── Image upload ──────────────────────────────────────────────────────────
  @Post(':id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @UseInterceptors(FileInterceptor('image', {
    storage: mediaStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      if (!file.mimetype.match(/^image\//)) return cb(new BadRequestException('Images only'), false);
      cb(null, true);
    },
  }))
  uploadImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.menuService.uploadImage(id, file, req.user);
  }

  // ── Serve image ───────────────────────────────────────────────────────────
  @Get(':id/image')
  async serveImage(@Param('id') id: string, @Res() res: Response) {
    const item = await this.menuService.findById(id);
    if (!item?.imageData) return res.status(404).send('Not found');
    const buf = Buffer.from((item as any).imageData, 'base64');
    res.set('Content-Type', (item as any).imageMime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  }

  // ── GLB (3D model) upload ─────────────────────────────────────────────────
  @Post(':id/glb')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  @UseInterceptors(FileInterceptor('glb', {
    storage: mediaStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      const ok = file.originalname.toLowerCase().endsWith('.glb') ||
                 file.mimetype === 'model/gltf-binary' ||
                 file.mimetype === 'application/octet-stream';
      if (!ok) return cb(new BadRequestException('GLB files only'), false);
      cb(null, true);
    },
  }))
  uploadGlb(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.menuService.uploadGlb(id, file, req.user);
  }

  // ── Serve GLB ─────────────────────────────────────────────────────────────
  @Get(':id/glb')
  async serveGlb(@Param('id') id: string, @Res() res: Response) {
    const item = await this.menuService.findById(id);
    if (!item?.glbData) return res.status(404).send('Not found');
    const buf = Buffer.from((item as any).glbData, 'base64');
    res.set('Content-Type', 'model/gltf-binary');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  }

  // ── Customer rating ───────────────────────────────────────────────────────
  @Post(':id/rate')
  rate(@Param('id') id: string, @Body() dto: RateDto) {
    return this.menuService.rate(id, dto.score);
  }

  @Patch(':id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'chef')
  toggle(@Param('id') id: string, @Request() req: any) {
    return this.menuService.toggleAvailability(id, req.user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  delete(@Param('id') id: string, @Request() req: any) {
    return this.menuService.delete(id, req.user);
  }
}
