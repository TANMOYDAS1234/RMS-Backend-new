// ─── Noop Payment Gateway ────────────────────────────────────────────────────
// Used when PSP env vars are unset — typically dev and cash-only restaurants.
// Returns 'completed' immediately so admin refund UX still works end-to-end;
// the actual money movement is expected to be cash returned by staff.

import { Injectable, Logger } from '@nestjs/common';
import { PaymentGateway, RefundResult } from './payment-gateway.interface';

@Injectable()
export class NoopGateway implements PaymentGateway {
  private readonly logger = new Logger(NoopGateway.name);

  async refund(chargeId: string, amount: number, reason: string): Promise<RefundResult> {
    this.logger.warn(
      `Noop refund: chargeId=${chargeId || 'cash'} amount=${amount} reason=${reason}`,
    );
    return {
      refundId: `noop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount,
      status: 'completed',
      provider: 'noop',
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
