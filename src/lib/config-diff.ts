import { prisma } from '@/lib/prisma';
import type { PanelSyncPayload } from '@/types/panel-sync';
import type {
  ConfigDiffResult,
  ConfigDiffSection,
  ConfigDiffLine,
} from '@/types/config-push';

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

  const sections: ConfigDiffSection[] = [];

  // Section 1: Chain Nodes — compare by label
  sections.push(
    buildChainNodesDiff(currentConfig?.chainNodes ?? [], newConfig.chainNodes),
  );

  // Section 2: WireGuard Peers — compare by publicKey
  sections.push(
    buildWireGuardPeersDiff(
      currentConfig?.wireguardPeers ?? [],
      newConfig.wireguardPeers,
    ),
  );

  // Section 3: Routing Rules — compare by composite key
  sections.push(
    buildRoutingRulesDiff(
      currentConfig?.routingRules ?? [],
      newConfig.routingRules,
    ),
  );

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

// ─── Section builders ─────────────────────────────────

function buildChainNodesDiff(
  current: PanelSyncPayload['chainNodes'],
  next: PanelSyncPayload['chainNodes'],
): ConfigDiffSection {
  const lines: ConfigDiffLine[] = [];
  const currentByKey = new Map(current.map((n) => [n.label, n]));
  const nextByKey = new Map(next.map((n) => [n.label, n]));
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  // Process new nodes — added or unchanged
  for (const node of next) {
    const existing = currentByKey.get(node.label);
    if (!existing) {
      lines.push({ type: 'added', content: formatChainNode(node) });
      added++;
    } else if (chainNodeEquals(existing, node)) {
      lines.push({ type: 'unchanged', content: formatChainNode(node) });
      unchanged++;
    } else {
      // Changed — show removal of old + addition of new
      lines.push({ type: 'removed', content: formatChainNode(existing) });
      lines.push({ type: 'added', content: formatChainNode(node) });
      added++;
      removed++;
    }
  }

  // Nodes in current but not in new — removed
  for (const node of current) {
    if (!nextByKey.has(node.label)) {
      lines.push({ type: 'removed', content: formatChainNode(node) });
      removed++;
    }
  }

  return {
    label: 'Chain Nodes',
    lines,
    summary: { added, removed, unchanged },
  };
}

function buildWireGuardPeersDiff(
  current: PanelSyncPayload['wireguardPeers'],
  next: PanelSyncPayload['wireguardPeers'],
): ConfigDiffSection {
  const lines: ConfigDiffLine[] = [];
  const currentByKey = new Map(current.map((p) => [p.publicKey, p]));
  const nextByKey = new Map(next.map((p) => [p.publicKey, p]));
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const peer of next) {
    const existing = currentByKey.get(peer.publicKey);
    if (!existing) {
      lines.push({ type: 'added', content: formatPeer(peer) });
      added++;
    } else if (peerEquals(existing, peer)) {
      lines.push({ type: 'unchanged', content: formatPeer(peer) });
      unchanged++;
    } else {
      lines.push({ type: 'removed', content: formatPeer(existing) });
      lines.push({ type: 'added', content: formatPeer(peer) });
      added++;
      removed++;
    }
  }

  for (const peer of current) {
    if (!nextByKey.has(peer.publicKey)) {
      lines.push({ type: 'removed', content: formatPeer(peer) });
      removed++;
    }
  }

  return {
    label: 'WireGuard Peers',
    lines,
    summary: { added, removed, unchanged },
  };
}

function buildRoutingRulesDiff(
  current: PanelSyncPayload['routingRules'],
  next: PanelSyncPayload['routingRules'],
): ConfigDiffSection {
  const lines: ConfigDiffLine[] = [];
  const currentByKey = new Map(current.map((r) => [ruleKey(r), r]));
  const nextByKey = new Map(next.map((r) => [ruleKey(r), r]));
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const rule of next) {
    const existing = currentByKey.get(ruleKey(rule));
    if (!existing) {
      lines.push({ type: 'added', content: formatRule(rule) });
      added++;
    } else {
      lines.push({ type: 'unchanged', content: formatRule(rule) });
      unchanged++;
    }
  }

  for (const rule of current) {
    if (!nextByKey.has(ruleKey(rule))) {
      lines.push({ type: 'removed', content: formatRule(rule) });
      removed++;
    }
  }

  return {
    label: 'Routing Rules',
    lines,
    summary: { added, removed, unchanged },
  };
}

// ─── Formatters ────────────────────────────────────────

function formatChainNode(n: PanelSyncPayload['chainNodes'][number]): string {
  return `${n.role} ${n.protocol}: ${n.label} (${n.hostname}:${n.port})`;
}

function formatPeer(p: PanelSyncPayload['wireguardPeers'][number]): string {
  const shortKey =
    p.publicKey.length > 12
      ? `${p.publicKey.substring(0, 12)}...`
      : p.publicKey;
  return `Peer ${shortKey} -> ${p.endpoint} [${p.allowedIPs}]`;
}

function formatRule(r: PanelSyncPayload['routingRules'][number]): string {
  return `${r.type}/${r.value} -> ${r.outboundTag} (priority ${r.priority})`;
}

// ─── Equality helpers ──────────────────────────────────

function chainNodeEquals(
  a: PanelSyncPayload['chainNodes'][number],
  b: PanelSyncPayload['chainNodes'][number],
): boolean {
  return (
    a.label === b.label &&
    a.serverId === b.serverId &&
    a.role === b.role &&
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.port === b.port
  );
}

function peerEquals(
  a: PanelSyncPayload['wireguardPeers'][number],
  b: PanelSyncPayload['wireguardPeers'][number],
): boolean {
  return (
    a.publicKey === b.publicKey &&
    a.allowedIPs === b.allowedIPs &&
    a.endpoint === b.endpoint &&
    a.persistentKeepalive === b.persistentKeepalive
  );
}

function ruleKey(r: PanelSyncPayload['routingRules'][number]): string {
  return `${r.type}:${r.value}:${r.outboundTag}:${r.priority}`;
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
