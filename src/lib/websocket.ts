import { Server as SocketIOServer } from 'socket.io';

declare global {
  var __socketIO: SocketIOServer | undefined;
}

/** WebSocket event types used across the application */
export type WsEventType =
  | 'stats:update'
  | 'resource:update'
  | 'alert:new'
  | 'user:status-change'
  | 'panel:fallback-change'
  | 'panel:push-progress'
  | 'chain:status-update';

export {};

let ioInstance: SocketIOServer | null = null;

/**
 * Get the Socket.IO server instance.
 * Throws if called before the server is initialized.
 */
export function getWebSocket(): SocketIOServer {
  if (!ioInstance) {
    throw new Error(
      '[ws] Socket.IO not initialized. Ensure the application is started via scripts/dev.cjs or scripts/start.cjs.',
    );
  }
  return ioInstance;
}

/**
 * Whether the Socket.IO server has been initialized. Lets health checks report
 * WebSocket readiness without throwing when the server is not yet running
 * (e.g. during tests or before server.mjs attaches the instance).
 */
export function isWebSocketReady(): boolean {
  return ioInstance !== null;
}

/**
 * Initialize the Socket.IO server.
 * This is called from server.mjs during startup.
 *
 * @param httpServer - The HTTP server to attach Socket.IO to (unused, kept for backward compatibility)
 * @param io - The Socket.IO server instance
 */
export function initWebSocketServer(
  _httpServer: unknown,
  io: SocketIOServer,
): void {
  if (ioInstance) {
    console.warn('[ws] Socket.IO already initialized, skipping');
    return;
  }

  ioInstance = io;
  console.log('[ws] Socket.IO server initialized');
}

/**
 * Broadcast an event to all connected clients.
 * Silently no-ops when WebSocket is not initialized (e.g., in tests or CLI usage).
 */
export function broadcastEvent(event: string, data: unknown): void {
  if (!ioInstance) return;
  ioInstance.emit(event, data);
}

/**
 * Keep initWebSocket as a no-op for backward compatibility.
 * The Socket.IO server is now created in server.mjs.
 */
export function initWebSocket(
  _httpServer: import('http').Server,
): SocketIOServer {
  const existing = getWebSocket();
  if (existing) return existing;
  throw new Error(
    '[ws] initWebSocket called but Socket.IO was not initialized by server.mjs. ' +
      'Ensure the application is started via scripts/dev.cjs or scripts/start.cjs.',
  );
}

/** Broadcast an alert to all connected clients. */
export function broadcastAlert(data: unknown): void {
  broadcastEvent('alert:new', data);
}

/** Broadcast dashboard stats update. */
export function broadcastStatsUpdate(data: unknown): void {
  broadcastEvent('stats:update', data);
}

/** Broadcast system resource update. */
export function broadcastResourceUpdate(data: unknown): void {
  broadcastEvent('resource:update', data);
}
