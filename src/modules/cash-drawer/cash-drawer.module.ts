import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CashDrawerShift, CashDrawerShiftSchema } from './cash-drawer.schema';
import { Bill, BillSchema } from '../billing/bill.schema';
import { CashDrawerService } from './cash-drawer.service';
import { CashDrawerController } from './cash-drawer.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CashDrawerShift.name, schema: CashDrawerShiftSchema },
      { name: Bill.name, schema: BillSchema },
    ]),
  ],
  controllers: [CashDrawerController],
  providers: [CashDrawerService],
  exports: [CashDrawerService],
})
export class CashDrawerModule {}
