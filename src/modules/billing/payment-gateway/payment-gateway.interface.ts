// ─── Payment Gateway Interface ───────────────────────────────────────────────
// Abstracts the PSP so AdminService.processRefund can call refund()
// without caring whether we ship Stripe, Razorpay, or a noop. The
// concrete provider is wired in payment-gateway.module via env var.

export interface RefundResult {
  /// PSP-specific transaction ID for reconciliation.
  refundId: string;
  /// Echo of the input for callers that want to display it.
  amount: number;
  /// 'completed' or 'pending'. PSPs that settle async return 'pending';
  /// the actual finalization comes via webhook.
  status: 'completed' | 'pending';
  /// Free-form provider name for logging.
  provider: string;
}

export interface PaymentGateway {
  /// Refund a bill via the configured PSP.
  ///
  /// [chargeId] — the original PSP charge ID stored on the Bill
  ///   when the payment was first captured. For cash bills there is no
  ///   chargeId; pass an empty string and the NoopGateway will short-circuit.
  /// [amount] — full or partial in the bill's currency.
  /// [reason] — captured in PSP metadata so it shows up in their dashboard.
  refund(chargeId: string, amount: number, reason: string): Promise<RefundResult>;

  /// Cheap health check that callers can invoke at boot to verify the
  /// gateway is reachable (e.g. ping Stripe's /v1/balance).
  ping(): Promise<boolean>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
