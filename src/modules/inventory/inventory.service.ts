import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import * as https from 'https';
import { Ingredient, IngredientDocument } from './ingredient.schema';
import { User, UserDocument } from '../users/user.schema';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Ingredient.name) private ingredientModel: Model<IngredientDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private config: ConfigService,
  ) {}

  async findAll() { return this.ingredientModel.find().lean(); }

  async findLowStock() {
    return this.ingredientModel.find({ $expr: { $lte: ['$currentStock', '$lowStockThreshold'] } }).lean();
  }

  async findById(id: string) {
    const item = await this.ingredientModel.findById(id).lean();
    if (!item) throw new NotFoundException('Ingredient not found');
    return item;
  }

  async create(dto: { name: string; unit: string; currentStock: number; lowStockThreshold: number; costPerUnit?: number }) {
    return this.ingredientModel.create(dto);
  }

  async adjustStock(id: string, delta: number, reason: string, by: string) {
    const item = await this.ingredientModel.findById(id);
    if (!item) throw new NotFoundException('Ingredient not found');

    const wasOk = item.currentStock > item.lowStockThreshold;
    item.currentStock = Math.max(0, item.currentStock + delta);
    item.stockLog.push({ delta, reason, by, at: new Date() });
    await item.save();

    // Fire low-stock notification only when crossing the threshold downward
    if (wasOk && item.currentStock <= item.lowStockThreshold) {
      this.sendLowStockNotification(item.name, item.currentStock, item.lowStockThreshold, item.unit).catch(() => {});
    }

    return item;
  }

  async update(id: string, dto: any) {
    const item = await this.ingredientModel.findByIdAndUpdate(id, dto, { new: true }).lean();
    if (!item) throw new NotFoundException('Ingredient not found');
    return item;
  }

  async delete(id: string) {
    await this.ingredientModel.findByIdAndDelete(id);
    return { deleted: true };
  }

  // ── FCM: send to all admin + manager tokens ─────────────────────────────────
  private async sendLowStockNotification(name: string, current: number, threshold: number, unit: string) {
    const admins = await this.userModel
      .find({ role: { $in: ['admin', 'manager'] }, fcmToken: { $exists: true, $ne: null } })
      .select('fcmToken')
      .lean();

    const tokens = admins.map((u) => u.fcmToken).filter(Boolean) as string[];
    if (!tokens.length) return;

    const projectId = this.config.get<string>('FCM_PROJECT_ID');
    const serviceAccountKey = this.config.get<string>('FCM_SERVICE_ACCOUNT_KEY');
    if (!projectId || !serviceAccountKey) return;

    const accessToken = await this.getFcmAccessToken(serviceAccountKey);
    if (!accessToken) return;

    const shortage = (threshold - current).toFixed(1);
    const body = `${name} is at ${current} ${unit} — ${shortage} ${unit} below minimum (${threshold} ${unit})`;

    await Promise.allSettled(
      tokens.map((token) =>
        this.postFcmMessage(projectId, accessToken, {
          token,
          notification: { title: '⚠️ Low Stock Alert', body },
          data: { type: 'LOW_STOCK', itemName: name, current: String(current), threshold: String(threshold), unit },
          android: { priority: 'high', notification: { channelId: 'low_stock' } },
          apns: { payload: { aps: { sound: 'default', badge: 1 } } },
        }),
      ),
    );
  }

  private getFcmAccessToken(serviceAccountKeyJson: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const key = JSON.parse(serviceAccountKeyJson);
        // Build JWT for Google OAuth2
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
          iss: key.client_email,
          scope: 'https://www.googleapis.com/auth/firebase.messaging',
          aud: 'https://oauth2.googleapis.com/token',
          iat: now,
          exp: now + 3600,
        })).toString('base64url');

        const crypto = require('crypto');
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(`${header}.${payload}`);
        const sig = sign.sign(key.private_key, 'base64url');
        const jwt = `${header}.${payload}.${sig}`;

        const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
        const req = https.request({
          hostname: 'oauth2.googleapis.com',
          path: '/token',
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postData.length },
        }, (res) => {
          let data = '';
          res.on('data', (c) => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data).access_token ?? null); }
            catch { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.write(postData);
        req.end();
      } catch { resolve(null); }
    });
  }

  private postFcmMessage(projectId: string, accessToken: string, message: object): Promise<void> {
    return new Promise((resolve) => {
      const body = JSON.stringify({ message });
      const req = https.request({
        hostname: 'fcm.googleapis.com',
        path: `/v1/projects/${projectId}/messages:send`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, () => resolve());
      req.on('error', () => resolve());
      req.write(body);
      req.end();
    });
  }
}
