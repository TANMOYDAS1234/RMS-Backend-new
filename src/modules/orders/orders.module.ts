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

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    TablesModule,
    BranchesModule,
    // SessionsModule depends on TablesModule (no cycle yet) but we use
    // forwardRef defensively — future trigger fanouts may cross-reference.
    forwardRef(() => SessionsModule),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
