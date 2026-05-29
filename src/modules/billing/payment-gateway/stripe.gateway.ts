// ─── Stripe Payment Gateway ──────────────────────────────────────────────────
// Stub implementation. Activate by setting STRIPE_SECRET_KEY in env and
// `npm install stripe`. We don't pull the SDK in by default so the build
// stays slim and unrelated bumps don't break the deploy.

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PaymentGateway, RefundResult } from './payment-gateway.interface';

@Injectable()
export class StripeGateway implements PaymentGateway {
  private readonly logger = new Logger(StripeGateway.name);

  // The real implementation will instantiate `new Stripe(secret, {...})`
  // here once the `stripe` npm package is installed.
  private get apiKey(): string {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        'StripeGateway selected but STRIPE_SECRET_KEY is not set',
      );
    }
    return key;
  }

  async refund(chargeId: string, amount: number, reason: string): Promise<RefundResult> {
    void this.apiKey; // assert key exists before pretending to call out
    this.logger.warn(
      `[STUB] Stripe refund.create not yet implemented — chargeId=${chargeId} amount=${amount}`,
    );
    // Real call would be roughly:
    //   const refund = await this.stripe.refunds.create({
    //     charge: chargeId,
    //     amount: Math.round(amount * 100), // Stripe wants cents
    //     reason: 'requested_by_customer',
    //     metadata: { reason },
    //   });
    //   return { refundId: refund.id, amount, status: refund.status === 'succeeded' ? 'completed' : 'pending', provider: 'stripe' };
    return {
      refundId: `stripe_stub_${Date.now()}`,
      amount,
      status: 'pending',
      provider: 'stripe',
    };
  }

  async ping(): Promise<boolean> {
    try {
      void this.apiKey;
      // Real impl: `await this.stripe.balance.retrieve()`
      return true;
    } catch {
      return false;
    }
  }
}
