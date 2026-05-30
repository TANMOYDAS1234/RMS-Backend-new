// ─── Orders Gateway (WebSocket) ──────────────────────────────────────────────

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  // Track ACK-pending events: eventId → { payload, retryCount, timer }
  private pendingAcks = new Map<string, { payload: any; retries: number; timer: NodeJS.Timeout }>();

  handleConnection(client: Socket) {
    // Staff clients pass { role } in handshake auth (their own role).
    // QR/customer clients pass { tableId, branchId } and join those rooms
    // so they only receive events for their own table — no cross-tenant
    // leak of order data to other diners.
    const role = client.handshake.auth?.role;
    const tableId = client.handshake.auth?.tableId;
    const branchId = client.handshake.auth?.branchId;
    if (role) client.join(`role:${role}`);
    if (branchId) client.join(`branch:${branchId}`);
    if (tableId) client.join(`table:${tableId}`);
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
