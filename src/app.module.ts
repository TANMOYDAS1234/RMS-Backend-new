import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { OrdersModule } from './modules/orders/orders.module';
import { UsersModule } from './modules/users/users.module';
import { MenuModule } from './modules/menu/menu.module';
import { TablesModule } from './modules/tables/tables.module';
import { BillingModule } from './modules/billing/billing.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { BranchesModule } from './modules/branches/branches.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdminModule } from './modules/admin/admin.module';
import { ManagerModule } from './modules/manager/manager.module';
import { PaymentGatewayModule } from './modules/billing/payment-gateway/payment-gateway.module';
import { StorageModule } from './common/storage/storage.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.get<string>('MONGODB_URI'),
        dbName: cfg.get<string>('DB_NAME', 'rms'),
      }),
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 60000, limit: 100 },
      { name: 'long', ttl: 3600000, limit: 2000 },
    ]),
    AuthModule,
    OrdersModule,
    UsersModule,
    MenuModule,
    TablesModule,
    BillingModule,
    InventoryModule,
    SessionsModule,
    BranchesModule,
    AnalyticsModule,
    AdminModule,
    ManagerModule,
    PaymentGatewayModule,
    StorageModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
