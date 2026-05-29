import { NoopGateway } from './noop.gateway';

describe('NoopGateway', () => {
  it('refund() returns completed status with a refundId prefix', async () => {
    const gw = new NoopGateway();
    const result = await gw.refund('charge_abc', 1500, 'customer complaint');
    expect(result.provider).toBe('noop');
    expect(result.status).toBe('completed');
    expect(result.amount).toBe(1500);
    expect(result.refundId.startsWith('noop_')).toBe(true);
  });

  it('ping() always returns true', async () => {
    expect(await new NoopGateway().ping()).toBe(true);
  });
});
