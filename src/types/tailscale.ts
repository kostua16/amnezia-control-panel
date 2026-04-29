/**
 * Tailscale types for the Amnezia Control Panel.
 *
 * TailscalePeer and TailscaleStatus mirror the JSON output of
 * `tailscale status --json`. Source:
 * https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go
 */

/**
 * Tailscale peer node from `tailscale status --json`.
 */
export interface TailscalePeer {
  ID: string;
  PublicKey: string;
  HostName: string;
  DNSName: string;
  OS: string;
  TailscaleIPs: string[];
  AllowedIPs?: string[];
  PrimaryRoutes?: string[];
  Online: boolean;
  Active: boolean;
  Relay: string;
  CurAddr: string;
  RxBytes: number;
  TxBytes: number;
  LastSeen?: string;
}

export interface TailscaleStatus {
  Version: string;
  BackendState: string;
  TailscaleIPs: string[];
  Self: TailscalePeer;
  Peer: Record<string, TailscalePeer>;
  CurrentTailnet: {
    Name: string;
    MagicDNSSuffix: string;
    MagicDNSEnabled: boolean;
  } | null;
  Health: string[];
}

/** Normalized node info returned by the panel API. */
export interface TailscaleNodeInfo {
  id: string;
  hostname: string;
  dnsName: string;
  os: string;
  tailscaleIPs: string[];
  online: boolean;
  relay: string;
  primaryRoutes: string[];
  isSelf: boolean;
}

/** Result from transport address resolution. */
export interface TransportAddress {
  tailscaleIP: string;
  hostname: string;
  port: number;
}
