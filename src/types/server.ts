export type ServerConnectionStatus = 'connected' | 'offline' | 'unknown';

export interface Server {
  id: number;
  name: string;
  hostname: string;
  port: number;
  isActive: boolean;
  connectionStatus?: ServerConnectionStatus;
  createdAt: Date;
}

export interface ServerWithServices extends Server {
  services: Array<{
    id: number;
    type: string;
    status: string;
    port: number | null;
  }>;
}

export interface ServerCreate {
  name: string;
  hostname: string;
  port?: number;
  apiKey: string;
}

export interface ServerUpdate {
  name?: string;
  hostname?: string;
  port?: number;
  apiKey?: string;
  isActive?: boolean;
}

export interface ServerTestResult {
  success: boolean;
  latencyMs: number | null;
  message: string;
  timestamp: string;
}
