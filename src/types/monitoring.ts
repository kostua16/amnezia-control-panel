// ─── Dashboard Stats ──────────────────────────────────

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
  trafficBytesInWindow: number;
  trafficBytesOutWindow: number;
  trafficWindowHours: number;
  servicesOnline: number;
  servicesTotal: number;
}

// ─── Traffic Buckets ──────────────────────────────────

export interface TrafficBucket {
  timestamp: string;
  bytesIn: number;
  bytesOut: number;
  userCount: number;
}

export interface TrafficStatsResponse {
  buckets: TrafficBucket[];
  totalIn: number;
  totalOut: number;
}

export interface TopUserTraffic {
  userId: number;
  username: string;
  totalBytesIn: number;
  totalBytesOut: number;
  totalBytes: number;
}

// ─── System Resources ─────────────────────────────────

export interface CpuInfo {
  usage: number;
  cores: number;
}

export interface MemoryInfo {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface DiskInfo {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface SystemResources {
  cpu: CpuInfo;
  memory: MemoryInfo;
  disk: DiskInfo;
  timestamp: string;
}

// ─── Legacy types (kept for backward compat) ──────────

export interface TrafficLog {
  id: number;
  userId: number;
  serverId: number;
  bytesIn: number;
  bytesOut: number;
  timestamp: Date;
}

export interface TrafficStats {
  userId: number;
  username: string;
  totalBytesIn: number;
  totalBytesOut: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface ServerResources {
  cpuPercent: number;
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  diskPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
  timestamp: Date;
}
