import { prisma } from '@/lib/prisma';
import type { PanelSyncPayload } from '@/types/panel-sync';
import type {
  ConfigDiffResult,
  ConfigDiffSection,
  ConfigDiffLine,
} from '@/types/config-push';

// ─── Generic Section Diff Builder ────────────────────────

/**
 * Build a diff section by comparing current vs next arrays using pluggable
 * key extraction, formatting, and equality functions.
 *
 * This eliminates duplicated diff logic across chain nodes, peers, and rules.
 */
function buildSectionDiff<T>(
  label: string,
  current: T[],
  next: T[],
  getKey: (item: T) => string,
  format: (item: T) => string,
  equals: (a: T, b: T) => boolean,
): ConfigDiffSection {
  const lines: ConfigDiffLine[] = [];
  const currentByKey = new Map(current.map((item) => [getKey(item), item]));
  const nextByKey = new Map(next.map((item) => [getKey(item), item]));
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const item of next) {
    const existing = currentByKey.get(getKey(item));
    if (!existing) {
      lines.push({ type: 'added', content: format(item) });
      added++;
    } else if (equals(existing, item)) {
      lines.push({ type: 'unchanged', content: format(item) });
      unchanged++;
    } else {
      lines.push({ type: 'removed', content: format(existing) });
      lines.push({ type: 'added', content: format(item) });
      added++;
      removed++;
    }
  }

  for (const item of current) {
    if (!nextByKey.has(getKey(item))) {
      lines.push({ type: 'removed', content: format(item) });
      removed++;
    }
  }

  return {
    label,
    lines,
    summary: { added, removed, unchanged },
  };
}

// ─── Specific Formatters & Equality Helpers ──────────────

type ChainNode = PanelSyncPayload['chainNodes'][number];
type Peer = PanelSyncPayload['wireguardPeers'][number];
type Rule = PanelSyncPayload['routingRules'][number];

function formatChainNode(n: ChainNode): string {
  return `${n.role} ${n.protocol}: ${n.label} (${n.hostname}:${n.port})`;
}

function formatPeer(p: Peer): string {
  const shortKey =
    p.publicKey.length > 12
      ? `${p.publicKey.substring(0, 12)}...`
      : p.publicKey;
  return `Peer ${shortKey} -> ${p.endpoint} [${p.allowedIPs}]`;
}

function formatRule(r: Rule): string {
  return `${r.type}/${r.value} -> ${r.outboundTag} (priority ${r.priority})`;
}

function chainNodeEquals(a: ChainNode, b: ChainNode): boolean {
  return (
    a.label === b.label &&
    a.serverId === b.serverId &&
    a.role === b.role &&
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.port === b.port
  );
}

function peerEquals(a: Peer, b: Peer): boolean {
  return (
    a.publicKey === b.publicKey &&
    a.allowedIPs === b.allowedIPs &&
    a.endpoint === b.endpoint &&
    a.persistentKeepalive === b.persistentKeepalive
  );
}

function ruleEquals(a: Rule, b: Rule): boolean {
  return (
    a.type === b.type &&
    a.value === b.value &&
    a.outboundTag === b.outboundTag &&
    a.priority === b.priority
  );
}

// ─── computeConfigDiff ─────────────────────────────────

/**
 * Compare current cached config for a panel with an incoming config.
 * Returns structured diff with sections for chain nodes, wireguard peers, and routing rules.
 */
export async function computeConfigDiff(
  panelId: number,
  panelName: string,
  newConfig: PanelSyncPayload,
): Promise<ConfigDiffResult> {
  // Fetch current cached config from DB
  const cachedConfig = await prisma.cachedPanelConfig.findUnique({
    where: { panelId },
  });

  const currentConfig: PanelSyncPayload | null = cachedConfig
    ? (cachedConfig.config as unknown as PanelSyncPayload)
    : null;

  const sections: ConfigDiffSection[] = [
    buildSectionDiff(
      'Chain Nodes',
      currentConfig?.chainNodes ?? [],
      newConfig.chainNodes,
      (n) => n.label,
      formatChainNode,
      chainNodeEquals,
    ),
    buildSectionDiff(
      'WireGuard Peers',
      currentConfig?.wireguardPeers ?? [],
      newConfig.wireguardPeers,
      (p) => p.publicKey,
      formatPeer,
      peerEquals,
    ),
    buildSectionDiff(
      'Routing Rules',
      currentConfig?.routingRules ?? [],
      newConfig.routingRules,
      (r) => `${r.type}:${r.value}:${r.outboundTag}:${r.priority}`,
      formatRule,
      ruleEquals,
    ),
  ];

  const hasChanges = sections.some(
    (s) => s.summary.added > 0 || s.summary.removed > 0,
  );

  return {
    panelId,
    panelName,
    hasChanges,
    sections,
    currentConfigFormatted: currentConfig
      ? JSON.stringify(currentConfig, null, 2)
      : null,
    newConfigFormatted: JSON.stringify(newConfig, null, 2),
  };
}

// ─── formatDiffForDisplay ─────────────────────────────

/**
 * Produce a human-readable diff string for logging/debugging.
 * Section headers with lines indented, prefixed with +, -, or space.
 */
export function formatDiffForDisplay(sections: ConfigDiffSection[]): string {
  const parts: string[] = [];

  for (const section of sections) {
    const { added, removed, unchanged } = section.summary;
    const header = `${section.label} (+${added}, -${removed}, ${unchanged} unchanged)`;
    parts.push(header);

    for (const line of section.lines) {
      const prefix =
        line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      parts.push(`  ${prefix} ${line.content}`);
    }

    parts.push(''); // blank line between sections
  }

  return parts.join('\n').trimEnd();
}
