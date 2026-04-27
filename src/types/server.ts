export interface Server {
  id: number;
  name: string;
  hostname: string;
  port: number;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateServerPayload {
  name: string;
  hostname: string;
  port?: number;
  apiKey: string;
}
