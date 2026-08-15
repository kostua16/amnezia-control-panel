import { prisma } from '@/lib/prisma';
import type { GenerateConfigOptions } from '@/types/config';

// ─── Config Generator ────────────────────────────────────

export async function generateConfig(
  templateId: number,
  options: GenerateConfigOptions = {},
): Promise<{
  id: number;
  type: string;
  name: string;
  content: Record<string, unknown>;
}> {
  const template = await prisma.configTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Start with template content as the base
  const config = {
    ...(template.content as Record<string, unknown>),
    ...(options.overrides ?? {}),
  };

  // Apply user-specific values if a userId is provided
  if (options.userId) {
    const user = await prisma.user.findUnique({
      where: { id: options.userId },
      include: { protocols: true },
    });

    if (!user) {
      throw new Error(`User not found: ${options.userId}`);
    }

    // Find the matching protocol for the template's serviceType
    const protocol = user.protocols.find(
      (p) => !template.serviceType || p.serviceType === template.serviceType,
    );

    if (protocol) {
      const protoConfig = protocol.config as Record<string, unknown>;

      // Merge user protocol config into generated config
      for (const [key, value] of Object.entries(protoConfig)) {
        if (value) {
          config[key] = value;
        }
      }
    }
  }

  if (options.serverId) {
    const service = await prisma.service.findUnique({
      where: { id: options.serverId },
      include: { server: true },
    });

    if (service && service.server) {
      const endpoint = service.server.redirectIp || service.server.hostname;
      const port = service.port || service.server.port;

      if (template.protocol === 'wireguard' || template.protocol === 'amneziawg') {
        if (!config.endpoint) config.endpoint = `${endpoint}:${port}`;
      } else {
        if (!config.address) config.address = endpoint;
        if (!config.port) config.port = port;

        const wsSettings = config.wsSettings as Record<string, unknown> | undefined;
        if (wsSettings && wsSettings.host === '') {
          wsSettings.host = endpoint;
        }

        const tlsSettings = config.tlsSettings as Record<string, unknown> | undefined;
        if (tlsSettings && tlsSettings.serverName === '') {
          tlsSettings.serverName = endpoint;
        }
      }
    }
  }

  // Validate the generated config
  validateConfig(config, template.protocol);

  // Store the configuration
  const configuration = await prisma.configuration.create({
    data: {
      type: template.protocol,
      name: `${template.name} - Generated`,
      content: config as never,
      isActive: true,
      serviceId: options.serverId ?? null,
    },
  });

  return {
    id: configuration.id,
    type: configuration.type,
    name: configuration.name,
    content: configuration.content as Record<string, unknown>,
  };
}

// ─── Validation ──────────────────────────────────────────

function validateConfig(
  config: Record<string, unknown>,
  protocol: string,
): void {
  const errors: string[] = [];

  switch (protocol) {
    case 'wireguard':
    case 'amneziawg': {
      if (!config.address) errors.push('Missing required field: address');
      if (!config.privateKey) errors.push('Missing required field: privateKey');
      break;
    }
    case 'vless': {
      if (!config.uuid) errors.push('Missing required field: uuid');
      break;
    }
    case 'vmess': {
      if (!config.id) errors.push('Missing required field: id');
      break;
    }
    case 'trojan': {
      if (!config.password) errors.push('Missing required field: password');
      break;
    }
    case 'shadowsocks': {
      if (!config.password) errors.push('Missing required field: password');
      if (!config.method) errors.push('Missing required field: method');
      break;
    }
    default:
      break;
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed: ${errors.join('; ')}`);
  }
}
