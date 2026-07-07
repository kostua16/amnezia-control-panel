import { prisma } from '@/lib/prisma';
import type { ChainPreset, ChainPresetCreate } from '@/types/chain-preset';

// ─── Built-in chain preset definitions ──────────────────

export interface ChainPresetDef {
  id: string;
  name: string;
  description: string;
  topology: 'LINEAR' | 'SPLIT' | 'MESH';
  nodeCount: number;
  chainTemplateId: string;
  routingBundleId: string | null;
  protocolOverrides: Record<string, unknown> | null;
}

export const BUILTIN_CHAIN_PRESETS: ChainPresetDef[] = [
  {
    id: 'simple-relay',
    name: 'Simple Relay',
    description:
      '2-node linear chain using VLESS-REALITY for high performance with minimal overhead. Best for general browsing.',
    topology: 'LINEAR',
    nodeCount: 2,
    chainTemplateId: '2hop-linear',
    routingBundleId: 'russia-direct',
    protocolOverrides: {
      entry: { protocol: 'xray', name: 'VLESS-REALITY' },
      exit: { protocol: 'xray', name: 'VLESS-REALITY' },
    },
  },
  {
    id: 'privacy-chain',
    name: 'Privacy Chain',
    description:
      '3-node chain with dedicated entry, middle relay, and exit servers. Maximum anonymity with routing through privacy-friendly jurisdiction.',
    topology: 'LINEAR',
    nodeCount: 3,
    chainTemplateId: '3hop-linear',
    routingBundleId: 'eu-privacy',
    protocolOverrides: {
      entry: { protocol: 'wireguard', name: 'AmneziaWG' },
      middle: { protocol: 'wireguard', name: 'WireGuard' },
      exit: { protocol: 'xray', name: 'VLESS-REALITY' },
    },
  },
  {
    id: 'high-performance',
    name: 'High Performance',
    description:
      'Optimized 2-node chain with VLESS-REALITY and aggressive MTU tuning. Lowest latency for streaming and gaming.',
    topology: 'LINEAR',
    nodeCount: 2,
    chainTemplateId: '2hop-linear',
    routingBundleId: 'full-tunnel',
    protocolOverrides: {
      entry: { protocol: 'xray', name: 'VLESS-REALITY' },
      exit: { protocol: 'xray', name: 'VLESS-REALITY' },
    },
  },
];

// ─── Seed built-in presets to DB ────────────────────────

export async function seedChainPresets(): Promise<{
  seeded: number;
  skipped: number;
}> {
  let seeded = 0;
  let skipped = 0;

  for (const preset of BUILTIN_CHAIN_PRESETS) {
    const existing = await prisma.chainPreset.findFirst({
      where: { name: preset.name, isBuiltIn: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.chainPreset.create({
      data: {
        name: preset.name,
        description: preset.description,
        topology: preset.topology,
        nodeCount: preset.nodeCount,
        chainTemplateId: preset.chainTemplateId,
        routingBundleId: preset.routingBundleId,
        protocolOverrides: preset.protocolOverrides as never,
        isBuiltIn: true,
      },
    });
    seeded++;
  }

  return { seeded, skipped };
}

// ─── CRUD Operations ────────────────────────────────────

export async function getChainPresets(): Promise<ChainPreset[]> {
  const presets = await prisma.chainPreset.findMany({
    orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
  });
  return presets.map(mapPreset);
}

export async function getChainPreset(id: number): Promise<ChainPreset | null> {
  const preset = await prisma.chainPreset.findUnique({ where: { id } });
  return preset ? mapPreset(preset) : null;
}

export async function createChainPreset(
  data: ChainPresetCreate,
): Promise<ChainPreset> {
  const preset = await prisma.chainPreset.create({
    data: {
      name: data.name,
      description: data.description ?? '',
      topology: data.topology ?? 'LINEAR',
      nodeCount: data.nodeCount ?? 2,
      chainTemplateId: data.chainTemplateId ?? '2hop-linear',
      routingBundleId: data.routingBundleId ?? null,
      protocolOverrides: (data.protocolOverrides ?? null) as never,
      isBuiltIn: false,
    },
  });
  return mapPreset(preset);
}

export async function deleteChainPreset(id: number): Promise<void> {
  const preset = await prisma.chainPreset.findUniqueOrThrow({
    where: { id },
  });

  if (preset.isBuiltIn) {
    throw new Error('Cannot delete built-in presets');
  }

  await prisma.chainPreset.delete({ where: { id } });
}

// ─── Mapping ────────────────────────────────────────────

function mapPreset(
  t: NonNullable<Awaited<ReturnType<typeof prisma.chainPreset.findUnique>>>,
): ChainPreset {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    topology: t.topology as ChainPreset['topology'],
    nodeCount: t.nodeCount,
    chainTemplateId: t.chainTemplateId,
    routingBundleId: t.routingBundleId,
    protocolOverrides: t.protocolOverrides as Record<string, unknown> | null,
    isBuiltIn: t.isBuiltIn,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
