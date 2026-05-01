import type { Node, Edge } from '@xyflow/react';
import type { ChainNode, ChainTopology } from '@/types/chain';
import { calculateNodePositions, CANVAS_PADDING } from '@/lib/chain-layout';

export interface ChainBuilderNode {
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
): Node<{ data: ChainBuilderNode }>[] {
  return builderNodes.map((builderNode) => ({
    id: builderNode.id,
    type: 'chainNode',
    position: positions[builderNode.id] ?? { x: CANVAS_PADDING, y: CANVAS_PADDING },
    data: { ...builderNode },
  }));
}

/**
 * Convert connection pairs to React Flow Edge[].
 */
export function toFlowEdges(
  connections: Array<{ fromId: string; toId: string }>,
  isCrossPanel?: (sourceId: string, targetId: string) => boolean,
): Edge[] {
  return connections.map(({ fromId, toId }) => {
    const cross = isCrossPanel?.(fromId, toId) ?? false;

    return {
      id: `edge-${fromId}-${toId}`,
      source: fromId,
      target: toId,
      type: 'smoothstep',
      animated: false,
      style: cross
        ? { stroke: '#94a3b8', strokeWidth: 2.5, strokeDasharray: '8 4' }
        : { stroke: '#94a3b8', strokeWidth: 1.5 },
      ...(cross ? { data: { crossPanel: true } } : {}),
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
