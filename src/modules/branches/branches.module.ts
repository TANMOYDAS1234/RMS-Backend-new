import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from './branch.schema';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';
import { User, UserSchema } from '../users/user.schema';
import { MenuItem, MenuItemSchema } from '../menu/menu.schema';
import { Table, TableSchema } from '../tables/table.schema';
import { Order, OrderSchema } from '../orders/order.schema';
import { Bill, BillSchema } from '../billing/bill.schema';
import { Ingredient, IngredientSchema } from '../inventory/ingredient.schema';

@Module({
  imports: [
    // Branch is owned by this module; the other six are read-only here
    // (we count them for the deletion-preview and cascade-delete paths).
    // forFeature only registers the model in this module's DI scope — it
    // doesn't duplicate the underlying collection, so each model still
    // lives on the canonical connection.
    MongooseModule.forFeature([
      { name: Branch.name, schema: BranchSchema },
      { name: User.name, schema: UserSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Table.name, schema: TableSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Bill.name, schema: BillSchema },
      { name: Ingredient.name, schema: IngredientSchema },
    ]),
  ],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
