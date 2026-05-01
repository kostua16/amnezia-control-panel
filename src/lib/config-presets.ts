import type { ServiceType } from '@/generated/prisma/enums';
import type { ConfigPreset } from '@/types/config';

// ─── Preset Definitions ─────────────────────────────────

const PRESETS: ConfigPreset[] = [
  {
    name: 'home-office',
    label: 'Home Office',
    description:
      'Balanced settings for home use. Good speed with moderate stealth. Uses VLESS-XTLS for best throughput.',
    serviceType: 'THREE_XUI',
    protocol: 'vless',
    settings: {
      network: 'tcp',
      security: 'tls',
      flow: 'xtls-rprx-vision',
      tlsSettings: {
        fingerprint: 'chrome',
        allowInsecure: false,
      },
      recommendedMtu: 1380,
      enableMux: false,
    },
    tags: ['balanced', 'performance', 'recommended'],
  },
  {
    name: 'business',
    label: 'Business',
    description:
      'High-reliability configuration with TLS and stable connection. Suitable for corporate VPN.',
    serviceType: 'THREE_XUI',
    protocol: 'vless',
    settings: {
      network: 'tcp',
      security: 'tls',
      flow: 'xtls-rprx-vision',
      tlsSettings: {
        fingerprint: 'firefox',
        allowInsecure: false,
      },
      recommendedMtu: 1380,
      enableMux: false,
      keepAlive: 30,
    },
    tags: ['stable', 'reliable', 'enterprise'],
  },
  {
    name: 'stealth',
    label: 'Stealth',
    description:
      'Maximum obfuscation for restrictive networks. Uses AmneziaWG with full obfuscation headers.',
    serviceType: 'AWG',
    protocol: 'amneziawg',
    settings: {
      mtu: 1280,
      persistentKeepalive: 15,
      junkPacketCount: 4,
      junkPacketMinSize: 10,
      junkPacketMaxSize: 64,
      initPacketJunkSize: 256,
      responsePacketJunkSize: 256,
      enableDnsFallback: true,
      dns: '1.1.1.1, 8.8.8.8',
    },
    tags: ['obfuscation', 'dpi-evasion', 'restrictive'],
  },
  {
    name: 'performance',
    label: 'Performance',
    description:
      'Optimized for maximum throughput. Standard WireGuard with tuned parameters.',
    serviceType: 'AWG',
    protocol: 'wireguard',
    settings: {
      mtu: 1420,
      persistentKeepalive: 25,
      allowedIPs: '0.0.0.0/0, ::/0',
      dns: '1.1.1.1, 1.0.0.1',
    },
    tags: ['fast', 'low-latency', 'optimized'],
  },
  {
    name: 'cdn-relay',
    label: 'CDN Relay',
    description:
      'Configuration for use behind CDN (Cloudflare, etc). VLESS over WebSocket for CDN compatibility.',
    serviceType: 'THREE_XUI',
    protocol: 'vless',
    settings: {
      network: 'ws',
      security: 'tls',
      wsSettings: {
        path: '/ws',
      },
      tlsSettings: {
        fingerprint: 'chrome',
        allowInsecure: false,
      },
      recommendedMtu: 1200,
      enableMux: true,
    },
    tags: ['cdn', 'cloudflare', 'relay'],
  },

  // --- Server presets (VPS provider defaults) ---
  {
    name: 'hetzner-ubuntu',
    label: 'Hetzner Ubuntu 24.04',
    description:
      'Optimized for Hetzner cloud servers running Ubuntu 24.04 LTS. Includes MTU tuning for Hetzner network and recommended kernel parameters.',
    serviceType: 'AWG',
    protocol: 'wireguard',
    settings: {
      mtu: 1400,
      persistentKeepalive: 25,
      recommendedMtu: 1400,
      dns: '1.1.1.1, 1.0.0.1',
      sysctl: {
        'net.ipv4.ip_forward': 1,
        'net.ipv6.conf.all.forwarding': 1,
      },
    },
    tags: ['hetzner', 'ubuntu', 'server'],
  },
  {
    name: 'digitalocean-ubuntu',
    label: 'DigitalOcean Ubuntu 24.04',
    description:
      'Optimized for DigitalOcean droplets running Ubuntu 24.04 LTS. Standard MTU and cloud-optimized settings.',
    serviceType: 'AWG',
    protocol: 'wireguard',
    settings: {
      mtu: 1380,
      persistentKeepalive: 25,
      recommendedMtu: 1380,
      dns: '1.1.1.1, 1.0.0.1',
      sysctl: {
        'net.ipv4.ip_forward': 1,
        'net.ipv6.conf.all.forwarding': 1,
      },
    },
    tags: ['digitalocean', 'ubuntu', 'server'],
  },
  {
    name: 'vultr-ubuntu',
    label: 'Vultr Ubuntu 24.04',
    description:
      'Optimized for Vultr cloud instances running Ubuntu 24.04 LTS. Balanced MTU for Vultr network infrastructure.',
    serviceType: 'AWG',
    protocol: 'wireguard',
    settings: {
      mtu: 1380,
      persistentKeepalive: 20,
      recommendedMtu: 1380,
      dns: '1.1.1.1, 8.8.8.8',
      sysctl: {
        'net.ipv4.ip_forward': 1,
        'net.ipv6.conf.all.forwarding': 1,
      },
    },
    tags: ['vultr', 'ubuntu', 'server'],
  },
  {
    name: 'contabo-ubuntu',
    label: 'Contabo Ubuntu 24.04',
    description:
      'Optimized for Contabo VPS running Ubuntu 24.04 LTS. Lower MTU for Contabo network and conservative keepalive.',
    serviceType: 'AWG',
    protocol: 'wireguard',
    settings: {
      mtu: 1350,
      persistentKeepalive: 30,
      recommendedMtu: 1350,
      dns: '1.1.1.1, 8.8.8.8',
      sysctl: {
        'net.ipv4.ip_forward': 1,
        'net.ipv6.conf.all.forwarding': 1,
      },
    },
    tags: ['contabo', 'ubuntu', 'server'],
  },
];

// ─── Preset Operations ──────────────────────────────────

export function getPresets(): ConfigPreset[] {
  return PRESETS;
}

export function getPreset(name: string): ConfigPreset | undefined {
  return PRESETS.find((p) => p.name === name);
}

export function getPresetsByServiceType(
  serviceType: ServiceType,
): ConfigPreset[] {
  return PRESETS.filter((p) => p.serviceType === serviceType);
}

/**
 * Apply a preset by merging its settings into a base config.
 * The preset settings are spread on top of the base, so explicit
 * overrides in the base are preserved.
 */
export function applyPreset(
  name: string,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const preset = getPreset(name);

  if (!preset) {
    throw new Error(`Unknown preset: ${name}`);
  }

  return {
    ...base,
    ...preset.settings,
    _preset: preset.name,
  };
}
