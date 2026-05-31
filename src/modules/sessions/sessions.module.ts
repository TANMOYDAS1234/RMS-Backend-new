import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TableSession, SessionSchema } from './session.schema';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { TablesModule } from '../tables/tables.module';
import { BranchesModule } from '../branches/branches.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TableSession.name, schema: SessionSchema }]),
    TablesModule,
    BranchesModule, // sessions.getOrCreate() calls isQrOrderingEnabled + isActive
    NotificationsModule, // for callWaiter push fanout
  ],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
