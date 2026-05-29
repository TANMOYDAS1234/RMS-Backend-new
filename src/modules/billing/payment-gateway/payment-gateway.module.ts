// ─── Payment Gateway Module ──────────────────────────────────────────────────
// Resolves which concrete gateway implements PAYMENT_GATEWAY based on the
// PAYMENT_PROVIDER env var (default: 'noop'). Exposed as a global module so
// AdminService and BillingService can inject it without re-importing.

import { Global, Module } from '@nestjs/common';
import { PAYMENT_GATEWAY } from './payment-gateway.interface';
import { NoopGateway } from './noop.gateway';
import { StripeGateway } from './stripe.gateway';

@Global()
@Module({
  providers: [
    NoopGateway,
    StripeGateway,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (noop: NoopGateway, stripe: StripeGateway) => {
        const provider = (process.env.PAYMENT_PROVIDER ?? 'noop').toLowerCase();
        switch (provider) {
          case 'stripe':
            return stripe;
          case 'noop':
          default:
            return noop;
        }
      },
      inject: [NoopGateway, StripeGateway],
    },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentGatewayModule {}
