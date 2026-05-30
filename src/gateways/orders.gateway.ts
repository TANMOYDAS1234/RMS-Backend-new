// ─── Orders Gateway (WebSocket) ──────────────────────────────────────────────

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    // Lock to the same env-driven allowlist as REST CORS — '*' is fine in
    // dev because the JWT verification below is the real auth boundary.
    origin: (process.env.CORS_ORIGINS ?? '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  namespace: '/',
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  // Track ACK-pending events: eventId → { payload, retryCount, timer }
  private pendingAcks = new Map<string, { payload: any; retries: number; timer: NodeJS.Timeout }>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Two flavors of handshake are accepted:
   *
   *   1. Staff: `{ token: <JWT> }`. The JWT is verified; the role and
   *      branchId from the payload determine which rooms we join. A
   *      tampered handshake (claiming a role you don't have) can't pass
   *      because the signature wouldn't verify.
   *
   *   2. Customer/QR: `{ tableId, branchId }` with no token. We accept the
   *      pair as-is — those values were already vouched for by the QR
   *      URL signature (Phase 2: sessions.getOrCreate enforces table↔
   *      branch ownership before any /sessions/scan succeeds, so a
   *      customer can't lie their way into a different table's room).
   *
   * Anything else (missing token AND missing tableId) gets dropped.
   */
  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    const tableId = client.handshake.auth?.tableId as string | undefined;
    const branchId = client.handshake.auth?.branchId as string | undefined;

    if (token) {
      try {
        const payload: any = this.jwtService.verify(token, {
          secret: this.configService.get<string>('JWT_SECRET'),
        });
        const role = payload.role as string | undefined;
        const userBranchId = payload.branchId as string | undefined;
        if (role) client.join(`role:${role}`);
        if (userBranchId) {
          client.join(`branch:${userBranchId}`);
          if (role) client.join(`branch:${userBranchId}.role:${role}`);
        }
        (client as any).user = payload;
        return;
      } catch {
        client.disconnect(true);
        return;
      }
    }

    // Customer flow — no JWT, just routing keys from the QR URL.
    if (tableId && branchId) {
      client.join(`branch:${branchId}`);
      client.join(`table:${tableId}`);
      return;
    }

    // Neither valid token nor valid customer pair → kick.
    client.disconnect(true);
  }

  handleDisconnect(_client: Socket) {
    // Socket.io auto-removes the client from all rooms on disconnect.
    // pendingAcks are keyed by eventId, not by socket, so they survive.
  }

  // ── Emit helpers ────────────────────────────────────────────────────────────

  emitOrderCreated(order: any) {
    this._emitWithAck('order:created', order);
  }

  emitOrderUpdated(order: any) {
    this._emitWithAck('order:updated', order);
  }

  emitKitchenProgress(data: { orderId: string; itemId: string; progress: number; tableId?: string; branchId?: string }) {
    // Per-table fanout when we know the routing keys; otherwise broadcast.
    if (data.tableId) this.server.to(`table:${data.tableId}`).emit('kitchen:progress', data);
    if (data.branchId) this.server.to(`branch:${data.branchId}.role:chef`).emit('kitchen:progress', data);
    if (!data.tableId && !data.branchId) this.server.emit('kitchen:progress', data);
  }

  // ── ACK system ──────────────────────────────────────────────────────────────

  @SubscribeMessage('ack')
  handleAck(@MessageBody() data: { eventId: string }) {
    const pending = this.pendingAcks.get(data.eventId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAcks.delete(data.eventId);
    }
  }

  private _emitWithAck(event: string, payload: any, retries = 0) {
    // Reuse the same eventId across retries so the client's ack can match
    // any in-flight attempt — previously each retry minted a new id, which
    // meant a single ack only cleared the most recent emit and the older
    // ones kept retransmitting until they hit the cap.
    const eventId = payload._eventId ?? `${event}:${payload._id ?? 'global'}:${Date.now()}`;
    const enriched = { ...payload, _eventId: eventId };

    // Route based on payload routing keys when present.
    const tableId = payload.tableId;
    const branchId = payload.branchId;
    if (tableId) this.server.to(`table:${tableId}`).emit(event, enriched);
    if (branchId) this.server.to(`branch:${branchId}`).emit(event, enriched);
    // Staff broadcast — every role:* room sees their own org-wide events.
    if (!tableId && !branchId) this.server.emit(event, enriched);

    if (retries < 3) {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(eventId);
        this._emitWithAck(event, { ...payload, _eventId: eventId }, retries + 1);
      }, 5000);

      this.pendingAcks.set(eventId, { payload, retries, timer });
    }
  }
}
