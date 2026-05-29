import {
  Controller, Get, Post, Patch, Delete, Body, Param, Request,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UsersService } from './users.service';
import { UserRole } from './user.schema';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateUserDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
}

class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() isActive?: boolean;
  @IsOptional() @IsString() branchId?: string;
}

const photoInterceptor = () => FileInterceptor('photo', {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.match(/^image\//)) return cb(new BadRequestException('Images only'), false);
    cb(null, true);
  },
});

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── List / Create ──────────────────────────────────────────────────────────
  @Get()
  @Roles('admin', 'manager')
  findAll() { return this.usersService.findAll(); }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateUserDto) { return this.usersService.create(dto); }

  // ── /me routes MUST come before /:id to avoid param collision ─────────────

  @Patch('me/fcm-token')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  updateFcmToken(@Request() req: any, @Body('fcmToken') fcmToken: string) {
    return this.usersService.update(req.user._id, { fcmToken });
  }

  @Post('me/photo')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  @UseInterceptors(photoInterceptor())
  uploadOwnPhoto(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.uploadPhoto(req.user._id, file);
  }

  // ── /:id routes ────────────────────────────────────────────────────────────

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string) { return this.usersService.findById(id); }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Post(':id/photo')
  @Roles('admin')
  @UseInterceptors(photoInterceptor())
  uploadPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.uploadPhoto(id, file);
  }

  @Get(':id/photo')
  async servePhoto(@Param('id') id: string, @Res() res: Response) {
    const user = await this.usersService.findByIdWithPhoto(id);
    if (!user?.photoData) return res.status(404).send('Not found');
    const buf = Buffer.from(user.photoData, 'base64');
    res.set('Content-Type', user.photoMime || 'image/jpeg');
    // Stable URL per user (/users/:id/photo) means uploads silently get
    // served stale unless callers append ?v=<updatedAt> AND intermediaries
    // honor query strings as cache keys. Belt-and-braces: ETag varies with
    // updatedAt so a 304 only returns when the doc actually matches, and
    // a short max-age means even uncached clients refetch fast.
    if ((user as any).updatedAt) {
      res.set('ETag', `"${new Date((user as any).updatedAt).getTime()}"`);
    }
    res.set('Cache-Control', 'private, max-age=60, must-revalidate');
    return res.send(buf);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) { return this.usersService.delete(id); }
}
