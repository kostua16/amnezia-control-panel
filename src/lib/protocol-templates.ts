import { prisma } from '@/lib/prisma';
import type { ServiceType } from '@/generated/prisma/enums';
import type { ProtocolTemplate } from '@/types/config';

// ─── Default Protocol Templates ─────────────────────────

const PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
  {
    name: 'Standard WireGuard',
    protocol: 'wireguard',
    serviceType: 'AWG',
    defaultConfig: {
      privateKey: '',
      address: '10.0.0.2/24',
      dns: '1.1.1.1, 8.8.8.8',
      mtu: 1420,
      persistentKeepalive: 25,
      allowedIPs: '0.0.0.0/0, ::/0',
    },
    description:
      'Standard WireGuard configuration with default MTU and DNS settings.',
  },
  {
    name: 'AmneziaWG',
    protocol: 'amneziawg',
    serviceType: 'AWG',
    defaultConfig: {
      privateKey: '',
      address: '10.0.0.2/24',
      dns: '1.1.1.1, 8.8.8.8',
      mtu: 1380,
      persistentKeepalive: 25,
      allowedIPs: '0.0.0.0/0, ::/0',
      junkPacketCount: 4,
      junkPacketMinSize: 10,
      junkPacketMaxSize: 64,
      initPacketJunkSize: 256,
      responsePacketJunkSize: 256,
      initPacketMagicHeader: 0x4a5a,
      responsePacketMagicHeader: 0x5a4a,
      underloadPacketMagicHeader: 0x4845,
      transportPacketMagicHeader: 0x4c59,
    },
    description:
      'AmneziaWG configuration with obfuscation headers for traffic disguise.',
  },
  {
    name: 'VLESS-XTLS-Vision',
    protocol: 'vless',
    serviceType: 'THREE_XUI',
    defaultConfig: {
      uuid: '',
      flow: 'xtls-rprx-vision',
      network: 'tcp',
      security: 'tls',
      tlsSettings: {
        serverName: '',
        fingerprint: 'chrome',
        allowInsecure: false,
      },
    },
    description:
      'VLESS protocol with XTLS Vision for best performance and stealth.',
  },
  {
    name: 'VLESS-WebSocket-CDN',
    protocol: 'vless',
    serviceType: 'THREE_XUI',
    defaultConfig: {
      uuid: '',
      flow: '',
      network: 'ws',
      wsSettings: {
        path: '/ws',
        host: '',
      },
      security: 'tls',
      tlsSettings: {
        serverName: '',
        fingerprint: 'chrome',
        allowInsecure: false,
      },
    },
    description:
      'VLESS over WebSocket with TLS, suitable for CDN relay setups.',
  },
  {
    name: 'VMess-WebSocket',
    protocol: 'vmess',
    serviceType: 'THREE_XUI',
    defaultConfig: {
      id: '',
      alterId: 0,
      network: 'ws',
      wsSettings: {
        path: '/vmess',
        host: '',
      },
      security: 'tls',
      tlsSettings: {
        serverName: '',
        fingerprint: 'chrome',
        allowInsecure: false,
      },
    },
    description:
      'VMess protocol over WebSocket with TLS for broad compatibility.',
  },
  {
    name: 'Trojan-TCP',
    protocol: 'trojan',
    serviceType: 'THREE_XUI',
    defaultConfig: {
      password: '',
      network: 'tcp',
      security: 'tls',
      tlsSettings: {
        serverName: '',
        fingerprint: 'chrome',
        allowInsecure: false,
      },
      sni: '',
    },
    description: 'Trojan protocol over TCP with TLS. Mimics HTTPS traffic.',
  },
  {
    name: 'Shadowsocks-2022',
    protocol: 'shadowsocks',
    serviceType: 'THREE_XUI',
    defaultConfig: {
      method: '2022-blake3-aes-256-gcm',
      password: '',
      network: 'tcp',
    },
    description:
      'Shadowsocks 2022 specification with AEAD 2022 cipher for modern security.',
  },
];

// ─── Seed Function ───────────────────────────────────────

export async function seedProtocolTemplates(): Promise<void> {
  try {
    const existingCount = await prisma.configTemplate.count({
      where: { isBuiltIn: true },
    });

    if (existingCount > 0) {
      console.log(
        `[protocol-templates] Skipping seed: ${existingCount} built-in templates already exist`,
      );
      return;
    }

    const data = PROTOCOL_TEMPLATES.map((t) => ({
      name: t.name,
      serviceType: t.serviceType as ServiceType,
      protocol: t.protocol,
      content: t.defaultConfig as never,
      description: t.description,
      isBuiltIn: true,
    }));

    const result = await prisma.configTemplate.createMany({ data });

    console.log(
      `[protocol-templates] Seeded ${result.count} built-in templates`,
    );
  } catch (error) {
    console.error('[protocol-templates] Seed failed:', error);
    throw error;
  }
}

// ─── Get Templates ───────────────────────────────────────

export function getProtocolTemplates(): ProtocolTemplate[] {
  return PROTOCOL_TEMPLATES;
}

export function getProtocolTemplate(
  protocol: string,
  serviceType: ServiceType,
): ProtocolTemplate | undefined {
  return PROTOCOL_TEMPLATES.find(
    (t) => t.protocol === protocol && t.serviceType === serviceType,
  );
}
