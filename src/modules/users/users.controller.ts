import {
  Controller, Get, Post, Patch, Delete, Body, Param, Request,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
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
}

const photoStorage = diskStorage({
  destination: './uploads',
  filename: (_, file, cb) => cb(null, `photo-${Date.now()}${extname(file.originalname)}`),
});

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

  @Post(':id/photo')
  @Roles('admin')
  @UseInterceptors(FileInterceptor('photo', {
    storage: photoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      if (!file.mimetype.match(/^image\//)) return cb(new BadRequestException('Only image files allowed'), false);
      cb(null, true);
    },
  }))
  uploadPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.uploadPhoto(id, file);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) { return this.usersService.delete(id); }
}
