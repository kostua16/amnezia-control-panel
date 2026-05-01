import { Server as SocketIOServer } from 'socket.io';

/**
 * Get the Socket.IO server instance.
 *
 * The Socket.IO server is created in `server.mjs` and attached to the HTTP
 * server at startup. It is stored on `globalThis.__socketIO` so that
 * server-side modules (broadcaster, alert service, etc.) can access it
 * without needing a direct reference to the HTTP server.
 *
 * Returns null if the server has not been initialized (e.g. during build or
 * when running without the custom server).
 */
export function getWebSocket(): SocketIOServer | null {
  return globalThis.__socketIO ?? null;
}

export type WsEventType =
  | 'stats:update'
  | 'resource:update'
  | 'alert:new'
  | 'user:status-change'
  | 'panel:fallback-change'
  | 'panel:push-progress'
  | 'chain:status-update';

/**
 * Broadcast an event to all connected clients.
 */
export function broadcastEvent<T>(event: WsEventType, data: T): void {
  const io = getWebSocket();
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

/**
 * Broadcast chain status update.
 */
export function broadcastChainStatusUpdate(payload: unknown): void {
  broadcastEvent('chain:status-update', payload);
}

// Keep initWebSocket as a no-op for backward compatibility.
// The Socket.IO server is now created in server.mjs.
export function initWebSocket(_httpServer: import('http').Server): SocketIOServer {
  const existing = getWebSocket();
  if (existing) return existing;
  throw new Error(
    '[ws] initWebSocket called but Socket.IO was not initialized by server.mjs. ' +
    'Ensure the application is started via scripts/dev.cjs or scripts/start.cjs.',
  );
}
