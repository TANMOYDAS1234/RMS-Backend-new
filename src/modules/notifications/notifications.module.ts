import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FcmToken, FcmTokenSchema } from './fcm-token.schema';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FcmToken.name, schema: FcmTokenSchema }]),
  ],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
