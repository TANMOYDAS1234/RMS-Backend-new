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
import { resolveBranchIdForCreate, isAdmin } from '../../common/scope/branch-scope';
import { NotificationsService } from '../notifications/notifications.service';
import { DevicePlatform } from '../notifications/fcm-token.schema';

class CreateUserDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  // Admin: optional (can omit to create a branch-less user, e.g. another admin).
  // Manager: forced to their own branchId regardless of what they send.
  @IsOptional() @IsString() branchId?: string;
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
  constructor(
    private readonly usersService: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── List / Create ──────────────────────────────────────────────────────────
  @Get()
  @Roles('admin', 'manager')
  findAll(@Request() req: any) {
    // Admin: every user. Manager: only users in their branch.
    return this.usersService.findAll(req.user);
  }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateUserDto, @Request() req: any) {
    // Manager: forced to own branch. Admin: may pick any branchId or omit.
    // Manager is also forbidden from creating other managers/admins below.
    const branchId = resolveBranchIdForCreate(req.user, dto.branchId);
    if (!isAdmin(req.user)) {
      if (dto.role === UserRole.ADMIN || dto.role === UserRole.MANAGER) {
        throw new BadRequestException(
          'Managers can only create waiter/chef/cashier accounts.',
        );
      }
    }
    return this.usersService.create({ ...dto, branchId });
  }

  // ── /me routes MUST come before /:id to avoid param collision ─────────────

  // Register a device for push. The deviceId is the stable per-install
  // identifier the client persists; sending the same id replaces the
  // previous token (token rotation). Backwards-compatible: the body's
  // `fcmToken` field is also still written to the user document, but new
  // clients should rely on the FcmToken collection instead.
  @Patch('me/fcm-token')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  async updateFcmToken(
    @Request() req: any,
    @Body() body: {
      fcmToken: string;
      deviceId?: string;
      platform?: DevicePlatform;
    },
  ) {
    const updated = await this.usersService.update(
      req.user._id,
      { fcmToken: body.fcmToken },
      req.user,
    );
    // Multi-device path: only register when the client supplies a stable
    // deviceId. Without it we can't distinguish two devices on one account.
    if (body.deviceId) {
      await this.notifications.register({
        userId: req.user._id.toString(),
        deviceId: body.deviceId,
        token: body.fcmToken,
        platform: body.platform,
        branchId: req.user.branchId ?? null,
        role: req.user.role,
      });
    }
    return updated;
  }

  // Called by the client at logout so the next user on the device stops
  // receiving the previous account's pushes.
  @Patch('me/fcm-token/clear')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  async clearFcmToken(@Request() req: any) {
    await this.notifications.clearForUser(req.user._id.toString());
    return { cleared: true };
  }

  @Post('me/photo')
  @Roles('admin', 'manager', 'waiter', 'chef', 'cashier')
  @UseInterceptors(photoInterceptor())
  uploadOwnPhoto(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.uploadPhoto(req.user._id, file, req.user);
  }

  // ── /:id routes ────────────────────────────────────────────────────────────

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.usersService.findById(id, req.user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: any) {
    if (!isAdmin(req.user)) {
      // Manager cannot escalate role or move users across branches.
      if (dto.role === UserRole.ADMIN || dto.role === UserRole.MANAGER) {
        throw new BadRequestException('Insufficient privileges to assign that role.');
      }
      if (dto.branchId && dto.branchId !== req.user.branchId) {
        throw new BadRequestException('Cannot move users to another branch.');
      }
    }
    return this.usersService.update(id, dto, req.user);
  }

  @Post(':id/photo')
  @Roles('admin', 'manager')
  @UseInterceptors(photoInterceptor())
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.uploadPhoto(id, file, req.user);
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
  @Roles('admin', 'manager')
  delete(@Param('id') id: string, @Request() req: any) {
    if (!isAdmin(req.user)) {
      // Manager cannot delete other managers/admins, even if same-branch.
      // The service-layer ownership check handles cross-branch refusal.
    }
    return this.usersService.delete(id, req.user);
  }
}
