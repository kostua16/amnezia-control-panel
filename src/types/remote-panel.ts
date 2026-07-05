export interface RemotePanel {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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

export interface PanelTestResult {
  success: boolean;
  panelId: number;
  latency: number | null;
  status?: PanelConnectionStatus;
  error?: string;
}

export type PanelConnectionStatus =
  'connected' | 'degraded' | 'offline' | 'unknown';
