import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';
import { Order, OrderSchema } from '../orders/order.schema';
import { Bill, BillSchema } from '../billing/bill.schema';
import { User, UserSchema } from '../users/user.schema';
import { Ingredient, IngredientSchema } from '../inventory/ingredient.schema';
import { Table, TableSchema } from '../tables/table.schema';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    OrdersModule,
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Bill.name, schema: BillSchema },
      { name: User.name, schema: UserSchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: Table.name, schema: TableSchema },
    ]),
  ],
  controllers: [ManagerController],
  providers: [ManagerService],
})
export class ManagerModule {}
