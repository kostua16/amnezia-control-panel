import { Server as SocketIOServer } from 'socket.io';

declare global {
  var __socketIO: SocketIOServer | undefined;
  /** Connected WebSocket client count, maintained by server.mjs connection handler. */
  var __wsClientCount: number;
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

/**
 * Get the Socket.IO server instance set by server.mjs at startup.
 * Returns undefined when the server has not started (tests, CLI usage).
 */
export function getWebSocket(): SocketIOServer | undefined {
  return globalThis.__socketIO;
}

/**
 * Whether the Socket.IO server has been initialized by server.mjs.
 * Lets health checks and broadcaster report WebSocket readiness without
 * throwing during tests or before startup.
 */
export function isWebSocketReady(): boolean {
  return globalThis.__socketIO !== undefined;
}

/**
 * Broadcast an event to all connected clients.
 * Silently no-ops when WebSocket is not initialized (e.g., in tests or CLI usage).
 */
export function broadcastEvent(event: string, data: unknown): void {
  globalThis.__socketIO?.emit(event, data);
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

/**
 * Check if any WebSocket clients are currently connected.
 * Used by the broadcaster to skip expensive queries when no one is listening.
 * Reads the counter maintained by server.mjs' io.on('connection') handler.
 */
export function hasConnectedClients(): boolean {
  return (globalThis.__wsClientCount ?? 0) > 0;
}
