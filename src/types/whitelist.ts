export type WhitelistType = 'domain' | 'ip' | 'cidr';

export interface WhitelistEntry {
  id: number;
  type: WhitelistType;
  /** The whitelist value (domain name, IP address, or CIDR range) */
  value: string;
  /** Optional description */
  description?: string;
  /** Server this whitelist applies to (null = global) */
  serverId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WhitelistCreate {
  type: WhitelistType;
  value: string;
  description?: string;
  serverId?: number | null;
  isActive?: boolean;
}

export interface WhitelistUpdate {
  type?: WhitelistType;
  value?: string;
  description?: string | null;
  serverId?: number | null;
  isActive?: boolean;
}
