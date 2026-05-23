import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/order.schema';
import { Bill, BillSchema } from '../billing/bill.schema';
import { User, UserSchema } from '../users/user.schema';
import { Ingredient, IngredientSchema } from '../inventory/ingredient.schema';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Bill.name, schema: BillSchema },
      { name: User.name, schema: UserSchema },
      { name: Ingredient.name, schema: IngredientSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
