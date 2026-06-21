import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Bill, BillSchema } from './bill.schema';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Bill.name, schema: BillSchema }]),
    OrdersModule,
    NotificationsModule,
    // AuditService is injected by BillingService to log refund approvals
    // and denials — without this import, refund events were invisible in
    // the audit feed.
    AuditModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
