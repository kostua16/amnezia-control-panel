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
