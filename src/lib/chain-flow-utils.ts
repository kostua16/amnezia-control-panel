import type { Node, Edge } from '@xyflow/react';
import type { ChainNode, ChainTopology } from '@/types/chain';
import type { RemotePanel } from '@/types/remote-panel';
import type { CrossPanelEdgeData } from '@/types/chain-flow';
import { calculateNodePositions, CANVAS_PADDING } from '@/lib/chain-layout';

export interface ChainBuilderNode {
  [key: string]: unknown;
  id: string;
  serverId: number | null;
  label: string;
  role: ChainNode['role'];
  protocol: ChainNode['protocol'];
}

/**
 * Convert domain ChainBuilderNode[] to React Flow Node[].
 */
export function toFlowNodes(
  builderNodes: ChainBuilderNode[],
  positions: Record<string, { x: number; y: number }>,
): Node<ChainBuilderNode>[] {
  return builderNodes.map((builderNode) => ({
    id: builderNode.id,
    type: 'chainNode',
    position: positions[builderNode.id] ?? { x: CANVAS_PADDING, y: CANVAS_PADDING },
    data: { ...builderNode },
  }));
}

/**
 * Convert connection pairs to React Flow Edge[].
 * When isCrossPanel returns true and panels data is available,
 * populates data with CrossPanelEdgeData for tooltip display.
 */
export function toFlowEdges(
  connections: Array<{ fromId: string; toId: string }>,
  isCrossPanel?: (sourceId: string, targetId: string) => boolean,
  options?: {
    panels?: RemotePanel[];
    serverPanelMap?: Record<number, number>;
    builderNodes?: ChainBuilderNode[];
  },
): Edge[] {
  const { panels, serverPanelMap, builderNodes } = options ?? {};

  // Build lookup: nodeId -> serverId
  const nodeServerMap = new Map<string, number | null>();
  if (builderNodes) {
    for (const n of builderNodes) {
      nodeServerMap.set(n.id, n.serverId);
    }
  }

  // Build lookup: panelId -> panelName
  const panelNameMap = new Map<number, string>();
  if (panels) {
    for (const p of panels) {
      panelNameMap.set(p.id, p.name);
    }
  }

  return connections.map(({ fromId, toId }) => {
    const cross = isCrossPanel?.(fromId, toId) ?? false;

    let edgeData: CrossPanelEdgeData | undefined;
    if (cross && serverPanelMap && panels) {
      const sourceServerId = nodeServerMap.get(fromId);
      const targetServerId = nodeServerMap.get(toId);
      const sourcePanelId = sourceServerId != null ? serverPanelMap[sourceServerId] : undefined;
      const targetPanelId = targetServerId != null ? serverPanelMap[targetServerId] : undefined;

      if (sourcePanelId !== undefined && targetPanelId !== undefined) {
        edgeData = {
          crossPanel: true,
          sourcePanelName: panelNameMap.get(sourcePanelId) ?? `Panel ${sourcePanelId}`,
          targetPanelName: panelNameMap.get(targetPanelId) ?? `Panel ${targetPanelId}`,
        };
      }
    }

    return {
      id: `edge-${fromId}-${toId}`,
      source: fromId,
      target: toId,
      type: 'smoothstep',
      animated: false,
      style: cross
        ? { stroke: '#94a3b8', strokeWidth: 2.5, strokeDasharray: '8 4' }
        : { stroke: '#94a3b8', strokeWidth: 1.5 },
      ...(edgeData ? { data: edgeData } : {}),
    };
  });
}

/**
 * Generate default node positions based on topology.
 * Wraps calculateNodePositions from chain-layout.ts.
 */
export function getDefaultPositions(
  nodeCount: number,
  topology: ChainTopology,
): Record<string, { x: number; y: number }> {
  const layoutNodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node-${i}`,
    label: '',
  }));

  const positions = calculateNodePositions(layoutNodes, topology);

  const result: Record<string, { x: number; y: number }> = {};
  for (const pos of positions) {
    result[pos.id] = { x: pos.x, y: pos.y };
  }
  return result;
}

/**
 * Reassign entry/exit/middle roles based on node order.
 * Returns a new array (does not mutate).
 */
export function reassignRoles(nodes: ChainBuilderNode[]): ChainBuilderNode[] {
  if (nodes.length === 0) return [];

  return nodes.map((node, i) => {
    if (i === 0) return { ...node, role: 'entry' as const };
    if (i === nodes.length - 1) return { ...node, role: 'exit' as const };
    return { ...node, role: 'middle' as const };
  });
}

/**
 * Generate a unique node ID.
 */
export function generateNodeId(): string {
  return 'node-' + Date.now();
}
