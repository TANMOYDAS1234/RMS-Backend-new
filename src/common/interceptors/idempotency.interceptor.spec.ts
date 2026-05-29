// ─── IdempotencyInterceptor — Unit Tests ─────────────────────────────────────

import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

function buildContext(method: string, path: string, headers: Record<string, any> = {}): ExecutionContext {
  const req = { method, path, headers };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as any;
}

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  const next = { handle: () => of('result') };

  beforeEach(() => {
    interceptor = new IdempotencyInterceptor();
  });

  it('passes GET requests through without an Idempotency-Key', () => {
    const ctx = buildContext('GET', '/orders');
    expect(() => interceptor.intercept(ctx, next as any)).not.toThrow();
  });

  it('rejects mutating requests with no Idempotency-Key', () => {
    const ctx = buildContext('POST', '/orders');
    expect(() => interceptor.intercept(ctx, next as any)).toThrow(BadRequestException);
  });

  it('accepts POST + Idempotency-Key', () => {
    const ctx = buildContext('POST', '/orders', { 'idempotency-key': 'abc-123' });
    expect(() => interceptor.intercept(ctx, next as any)).not.toThrow();
  });

  it('accepts PATCH + Idempotency-Key', () => {
    const ctx = buildContext('PATCH', '/orders/123/status', { 'idempotency-key': 'k' });
    expect(() => interceptor.intercept(ctx, next as any)).not.toThrow();
  });

  it('requires Idempotency-Key on /manager/order-action — guarantees prior exemption is dead', () => {
    const ctx = buildContext('PATCH', '/manager/order-action/force-close/123');
    expect(() => interceptor.intercept(ctx, next as any)).toThrow(BadRequestException);
  });

  it('requires Idempotency-Key on /admin/billing/X/refund', () => {
    const ctx = buildContext('PATCH', '/admin/billing/123/refund');
    expect(() => interceptor.intercept(ctx, next as any)).toThrow(BadRequestException);
  });
});
