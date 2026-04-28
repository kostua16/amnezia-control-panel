import { prisma } from '@/lib/prisma';
import type { ServiceType } from '@/generated/prisma/enums';
import type { ConfigExport } from '@/types/config';

// ─── Export Functions ────────────────────────────────────

export async function exportAllConfigs(): Promise<ConfigExport> {
  const [configurations, templates] = await Promise.all([
    prisma.configuration.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.configTemplate.findMany({
      orderBy: [{ name: 'asc' }],
    }),
  ]);

  return buildExport(configurations, templates);
}

export async function exportConfigsByService(
  serviceType: string,
): Promise<ConfigExport> {
  const configurations = await prisma.configuration.findMany({
    where: {
      service: {
        type: serviceType as ServiceType,
      },
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      service: {
        select: { type: true },
      },
    },
  });

  const templates = await prisma.configTemplate.findMany({
    where: { serviceType: serviceType as ServiceType },
    orderBy: [{ name: 'asc' }],
  });

  return buildExport(configurations, templates);
}

// ─── Build Export ────────────────────────────────────────

function buildExport(
  configurations: Array<{
    id: number;
    type: string;
    name: string;
    content: unknown;
    isActive: boolean;
    serviceId: number | null;
    service?: { type: ServiceType } | null;
  }>,
  templates: Array<{
    name: string;
    serviceType: ServiceType | null;
    protocol: string;
    content: unknown;
    description: string;
  }>,
): ConfigExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    configurations: configurations.map((c) => ({
      type: c.type,
      name: c.name,
      content: c.content as Record<string, unknown>,
      isActive: c.isActive,
      serviceType: c.service?.type ?? undefined,
    })),
    templates: templates.map((t) => ({
      name: t.name,
      serviceType: t.serviceType ?? '',
      protocol: t.protocol,
      content: t.content as Record<string, unknown>,
      description: t.description,
    })),
  };
}
