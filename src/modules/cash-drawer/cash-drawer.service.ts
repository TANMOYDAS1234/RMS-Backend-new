import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CashDrawerShift, CashDrawerShiftDocument, ShiftStatus } from './cash-drawer.schema';
import { Bill, BillDocument, PaymentMethod } from '../billing/bill.schema';
import { AuthUser, assertOwnsBranch, scopeFilter } from '../../common/scope/branch-scope';

@Injectable()
export class CashDrawerService {
  constructor(
    @InjectModel(CashDrawerShift.name) private shiftModel: Model<CashDrawerShiftDocument>,
    @InjectModel(Bill.name) private billModel: Model<BillDocument>,
  ) {}

  /**
   * Start a shift. Fails if the same cashier already has one open — the
   * compound unique index gives us that for free, but we want a friendly
   * error rather than a Mongo duplicate-key blob.
   */
  async open(dto: { openingBalance: number; cashierName?: string }, user: AuthUser) {
    if (!user?.branchId) throw new BadRequestException('Cashier must be assigned to a branch.');
    const existing = await this.shiftModel.findOne({
      cashierId: (user as any)._id,
      status: ShiftStatus.OPEN,
    });
    if (existing) {
      throw new ConflictException('You already have an open shift. Close it before opening a new one.');
    }
    return this.shiftModel.create({
      branchId: user.branchId,
      cashierId: (user as any)._id,
      cashierName: dto.cashierName,
      openingBalance: dto.openingBalance,
      openedAt: new Date(),
      status: ShiftStatus.OPEN,
    });
  }

  /** Currently-open shift for the caller, or null. */
  async current(user: AuthUser) {
    return this.shiftModel
      .findOne({ cashierId: (user as any)._id, status: ShiftStatus.OPEN })
      .lean();
  }

  /**
   * Close the shift. Server is the authority on expectedCash — it sums
   * every CASH bill paid by this cashier between openedAt and now. The
   * client-supplied closingBalance is the physical count; variance is
   * the difference, surfaced to the manager via the audit endpoint.
   */
  async close(
    shiftId: string,
    dto: { closingBalance: number; note?: string },
    user: AuthUser,
  ) {
    const shift = await this.shiftModel.findById(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');
    assertOwnsBranch(user, shift as any);
    if (shift.cashierId !== (user as any)._id.toString()) {
      throw new BadRequestException('You can only close your own shift.');
    }
    if (shift.status === ShiftStatus.CLOSED) {
      throw new BadRequestException('Shift is already closed.');
    }

    // Sum cash bills paid by this cashier during the shift window.
    const cashSum = await this.billModel.aggregate([
      {
        $match: {
          cashierId: shift.cashierId,
          isPaid: true,
          paidAt: { $gte: shift.openedAt, $lte: new Date() },
          $or: [
            { paymentMethod: PaymentMethod.CASH },
            { 'splitPayments.method': PaymentMethod.CASH },
          ],
        },
      },
      {
        $project: {
          // For split bills, only the cash slice counts.
          cashAmount: {
            $cond: [
              { $eq: ['$paymentMethod', PaymentMethod.CASH] },
              '$total',
              {
                $sum: {
                  $map: {
                    input: { $ifNull: ['$splitPayments', []] },
                    as: 's',
                    in: {
                      $cond: [
                        { $eq: ['$$s.method', PaymentMethod.CASH] },
                        '$$s.amount',
                        0,
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
      { $group: { _id: null, total: { $sum: '$cashAmount' } } },
    ]);
    const expectedCash = +(cashSum[0]?.total ?? 0);
    const variance = +(dto.closingBalance - (shift.openingBalance + expectedCash)).toFixed(2);

    shift.status = ShiftStatus.CLOSED;
    shift.closingBalance = dto.closingBalance;
    shift.expectedCash = expectedCash;
    shift.variance = variance;
    shift.closingNote = dto.note;
    shift.closedAt = new Date();
    return shift.save();
  }

  /** Manager/admin audit listing — branch-scoped. */
  async list(user: AuthUser, status?: ShiftStatus, limit = 50) {
    const q: any = { ...scopeFilter(user) };
    if (status) q.status = status;
    return this.shiftModel
      .find(q)
      .sort({ openedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .lean();
  }
}
