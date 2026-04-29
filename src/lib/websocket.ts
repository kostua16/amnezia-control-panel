import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export type WsEventType =
  | 'stats:update'
  | 'resource:update'
  | 'alert:new'
  | 'user:status-change'
  | 'panel:fallback-change';

/**
 * Initialize the Socket.io server. Safe to call multiple times.
 */
export function initWebSocket(httpServer: HttpServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    path: '/api/ws',
    addTrailingSlash: false,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`[ws] Client connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[ws] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
}

/**
 * Get the initialized Socket.io server instance.
 * Returns null if not yet initialized.
 */
export function getWebSocket(): SocketIOServer | null {
  return io;
}

/**
 * Broadcast an event to all connected clients.
 */
export function broadcastEvent<T>(event: WsEventType, data: T): void {
  if (!io) {
    console.warn(`[ws] Cannot broadcast "${event}": WebSocket not initialized`);
    return;
  }
  io.emit(event, data);
}

/**
 * Broadcast dashboard stats update.
 */
export function broadcastStatsUpdate(stats: unknown): void {
  broadcastEvent('stats:update', stats);
}

/**
 * Broadcast system resource update.
 */
export function broadcastResourceUpdate(resources: unknown): void {
  broadcastEvent('resource:update', resources);
}

/**
 * Broadcast a new alert.
 */
export function broadcastAlert(alert: unknown): void {
  broadcastEvent('alert:new', alert);
}

/**
 * Broadcast user status change.
 */
export function broadcastUserStatusChange(payload: unknown): void {
  broadcastEvent('user:status-change', payload);
}
