export interface RemotePanel {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemotePanelWithHistory extends RemotePanel {
  connectionHistory: PanelConnectionRecord[];
}

export interface RemotePanelCreate {
  name: string;
  panelUrl: string;
  apiKey: string;
}

export interface RemotePanelUpdate {
  name?: string;
  panelUrl?: string;
  apiKey?: string;
  isActive?: boolean;
}

export interface PanelConnectionRecord {
  id: number;
  success: boolean;
  latencyMs: number | null;
  message: string;
  version: string | null;
  checkedAt: string;
}

export interface PanelTestResult {
  success: boolean;
  panelId: number;
  latency: number | null;
  status?: PanelConnectionStatus;
  error?: string;
}

export type PanelConnectionStatus =
  | 'connected'
  | 'degraded'
  | 'offline'
  | 'unknown';
