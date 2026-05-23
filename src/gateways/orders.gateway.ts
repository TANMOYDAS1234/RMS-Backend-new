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
    const role = client.handshake.auth?.role;
    if (role) client.join(`role:${role}`);
  }

  handleDisconnect(client: Socket) {
    // Clean up any pending ACKs for this client
  }

  // ── Emit helpers ────────────────────────────────────────────────────────────

  emitOrderCreated(order: any) {
    this._emitWithAck('order:created', order);
  }

  emitOrderUpdated(order: any) {
    this._emitWithAck('order:updated', order);
  }

  emitKitchenProgress(data: { orderId: string; itemId: string; progress: number }) {
    this.server.emit('kitchen:progress', data);
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
    const eventId = `${event}:${payload._id}:${Date.now()}`;
    const enriched = { ...payload, _eventId: eventId };

    this.server.emit(event, enriched);

    if (retries < 3) {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(eventId);
        this._emitWithAck(event, payload, retries + 1);
      }, 5000);

      this.pendingAcks.set(eventId, { payload, retries, timer });
    }
  }
}
