// ─── Orders Module ───────────────────────────────────────────────────────────

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from './order.schema';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from '../../gateways/orders.gateway';
import { TablesModule } from '../tables/tables.module';
import { BranchesModule } from '../branches/branches.module';
import { SessionsModule } from '../sessions/sessions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    TablesModule,
    BranchesModule,
    forwardRef(() => SessionsModule),
    NotificationsModule,
    AuthModule, // OrdersGateway needs JwtService to verify WS handshake tokens
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
