import type { ServiceType } from '@/generated/prisma/enums';

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  isActive: boolean;
  isBlocked: boolean;
  trafficQuotaBytes: number;
  speedLimitKbps: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithServices extends User {
  assignedServices: ServiceType[];
}

export interface UserListItem {
  id: number;
  username: string;
  displayName: string | null;
  isActive: boolean;
  isBlocked: boolean;
  trafficQuotaBytes: number;
  speedLimitKbps: number;
  assignedServices: ServiceType[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  displayName?: string;
  trafficQuotaBytes?: number;
  speedLimitKbps?: number;
  services?: ServiceType[];
}

export interface UpdateUserPayload {
  displayName?: string | null;
  trafficQuotaBytes?: number;
  speedLimitKbps?: number;
  isActive?: boolean;
  newPassword?: string;
  services?: ServiceType[];
}
