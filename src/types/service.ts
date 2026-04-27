import type { ServiceType, ServiceStatus } from '@/generated/prisma/enums';

export interface Service {
  id: number;
  type: ServiceType;
  status: ServiceStatus;
  port: number | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  serverId: number;
}

export interface ServiceWithServer extends Service {
  serverName: string;
  serverHostname: string;
}

export interface ServiceStatusResponse {
  type: ServiceType;
  status: ServiceStatus;
  lastCheckedAt: string;
}
