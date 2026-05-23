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

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('admin', 'manager')
  findAll() { return this.usersService.findAll(); }

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string) { return this.usersService.findById(id); }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateUserDto) { return this.usersService.create(dto); }

  @Patch('me/fcm-token')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  updateFcmToken(@Request() req: any, @Body('fcmToken') fcmToken: string) {
    return this.usersService.update(req.user._id, { fcmToken });
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) { return this.usersService.update(id, dto); }

  @Post('me/photo')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  @UseInterceptors(FileInterceptor('photo', {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      if (!file.mimetype.match(/^image\//)) return cb(new BadRequestException('Images only'), false);
      cb(null, true);
    },
  }))
  uploadOwnPhoto(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.uploadPhoto(req.user._id, file);
  }

  @Post(':id/photo')
  @Roles('admin')
  @UseInterceptors(FileInterceptor('photo', {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      if (!file.mimetype.match(/^image\//)) return cb(new BadRequestException('Images only'), false);
      cb(null, true);
    },
  }))
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
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) { return this.usersService.delete(id); }
}
