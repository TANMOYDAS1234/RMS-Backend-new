// ─── ManagerService — Unit Tests ────────────────────────────────────────────
// Focus: optimistic locking (the conflict path) and the DTO clamps.

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ManagerService } from './manager.service';
import { OrderStatus } from '../orders/order.schema';
import { ManagerActionType } from './manager-action-log.schema';

const _validId = () => new Types.ObjectId().toHexString();

function fakeOrder(overrides: Partial<any> = {}): any {
  return {
    _id: 'order_1',
    tableLabel: 'T-01',
    status: OrderStatus.PREPARING,
    version: 5,
    subtotal: 1000,
    auditLog: [] as any[],
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildService(orderModel: any, actionLogModel: any = mockActionLog()): ManagerService {
  return new ManagerService(
    orderModel,
    { findOneAndUpdate: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    actionLogModel,
    { emitOrderUpdated: jest.fn() } as any,
  );
}

function mockActionLog() {
  // create() returns a Promise that swallows errors, mirroring _audit's
  // fire-and-forget contract.
  return { create: jest.fn().mockReturnValue(Promise.resolve({})), find: jest.fn(), countDocuments: jest.fn() } as any;
}

describe('ManagerService.forceCloseOrder', () => {
  it('throws ConflictException when expectedVersion does not match', async () => {
    const order = fakeOrder({ version: 5 });
    const orderModel = { findById: jest.fn().mockResolvedValue(order) };
    const svc = buildService(orderModel);

    await expect(svc.forceCloseOrder(_validId(), 'mgr_1', 3))
      .rejects.toBeInstanceOf(ConflictException);
    expect(order.save).not.toHaveBeenCalled();
  });

  it('writes the audit log with PRE-mutation status', async () => {
    const order = fakeOrder({ version: 5, status: OrderStatus.PREPARING });
    const orderModel = { findById: jest.fn().mockResolvedValue(order) };
    const actionLog = mockActionLog();
    const svc = buildService(orderModel, actionLog);

    await svc.forceCloseOrder(_validId(), 'mgr_1', 5);

    // Order audit entry should reference PREPARING, not CLOSED.
    expect(order.auditLog[0].meta.previousStatus).toBe(OrderStatus.PREPARING);
    expect(order.status).toBe(OrderStatus.CLOSED);
    // ManagerActionLog must have been written with before/after snapshot.
    expect(actionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: ManagerActionType.FORCE_CLOSE,
      before: { status: OrderStatus.PREPARING },
      after:  { status: OrderStatus.CLOSED },
    }));
  });

  it('throws BadRequestException when the order is already closed', async () => {
    const order = fakeOrder({ status: OrderStatus.CLOSED });
    const orderModel = { findById: jest.fn().mockResolvedValue(order) };
    const svc = buildService(orderModel);
    await expect(svc.forceCloseOrder(_validId(), 'mgr_1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFoundException when the order does not exist', async () => {
    const orderModel = { findById: jest.fn().mockResolvedValue(null) };
    const svc = buildService(orderModel);
    await expect(svc.forceCloseOrder('missing', 'mgr_1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('translates Mongoose VersionError → ConflictException on save', async () => {
    const order = fakeOrder({ version: 5 });
    order.save.mockRejectedValue({ name: 'VersionError' });
    const orderModel = { findById: jest.fn().mockResolvedValue(order) };
    const svc = buildService(orderModel);
    await expect(svc.forceCloseOrder('order_1', 'mgr_1', 5))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ManagerService.applyDiscount', () => {
  it('rejects NaN/Infinity/<0/>100 discountPercent', async () => {
    const orderModel = { findById: jest.fn().mockResolvedValue(fakeOrder()) };
    const svc = buildService(orderModel);
    for (const bad of [NaN, Infinity, -1, 101]) {
      await expect(svc.applyDiscount(_validId(), bad, 'mgr_1', 'why'))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('computes discountAmount + gst + total at 18% GST', async () => {
    const order = fakeOrder({ subtotal: 1000, version: 1 });
    const orderModel = { findById: jest.fn().mockResolvedValue(order) };
    const billModel = { findOneAndUpdate: jest.fn() };
    const svc = new ManagerService(
      orderModel as any,
      billModel as any,
      {} as any, {} as any, {} as any,
      mockActionLog(),
      { emitOrderUpdated: jest.fn() } as any,
    );

    await svc.applyDiscount(_validId(), 20, 'mgr_1', 'VIP', 1);
    // 1000 - 200 = 800 net, 800 * 0.18 = 144 gst, total = 944
    expect(order.discountAmount).toBe(200);
    expect(order.gstAmount).toBe(144);
    expect(order.total).toBe(944);
  });
});
