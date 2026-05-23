// ─── Sessions Service ─────────────────────────────────────────────────────────

import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TableSession, SessionDocument, SessionStatus } from './session.schema';
import { TablesService } from '../tables/tables.service';

const SESSION_TTL_MINUTES = 30;

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(TableSession.name) private sessionModel: Model<SessionDocument>,
    private tablesService: TablesService,
  ) {}

  /**
   * QR scan entry point.
   * - Resumes active session if one exists
   * - Blocks if bill is pending
   * - Creates new session otherwise
   */
  async getOrCreate(tableId: string, branchId: string, deviceId: string) {
    const table = await this.tablesService.findById(tableId);

    // Check for existing active session
    const existing = await this.sessionModel.findOne({
      tableId,
      status: SessionStatus.ACTIVE,
    });

    if (existing) {
      if (existing.billPending) {
        throw new ConflictException('Bill is pending. Please complete payment before placing new orders.');
      }
      // Add participant if not already present
      const alreadyJoined = existing.participants.some((p) => p.deviceId === deviceId);
      if (!alreadyJoined) {
        existing.participants.push({ deviceId, joinedAt: new Date() });
        await existing.save();
      }
      return existing;
    }

    // Create new session
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
    return this.sessionModel.create({
      tableId,
      tableLabel: table.label,
      branchId,
      expiresAt,
      participants: [{ deviceId, joinedAt: new Date() }],
    });
  }

  async addOrder(sessionId: string, orderId: string) {
    const session = await this.sessionModel.findById(sessionId);
    if (!session) throw new NotFoundException('Session not found');
    if (!session.orderIds.includes(orderId)) {
      session.orderIds.push(orderId);
      await session.save();
    }
    return session;
  }

  async markBillPending(tableId: string) {
    await this.sessionModel.updateOne(
      { tableId, status: SessionStatus.ACTIVE },
      { billPending: true },
    );
  }

  async closeSession(tableId: string) {
    await this.sessionModel.updateOne(
      { tableId, status: SessionStatus.ACTIVE },
      { status: SessionStatus.CLOSED },
    );
  }

  async getActiveSession(tableId: string) {
    return this.sessionModel.findOne({ tableId, status: SessionStatus.ACTIVE }).lean();
  }

  // Extend TTL on activity
  async refreshExpiry(sessionId: string) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
    await this.sessionModel.findByIdAndUpdate(sessionId, { expiresAt });
  }
}
