import {
  toFlowNodes,
  toFlowEdges,
  getDefaultPositions,
  type ChainBuilderNode,
} from '@/lib/chain-flow-utils';
import { CANVAS_PADDING } from '@/lib/chain-layout';
import type { ChainTopology } from '@/types/chain';
import type { RemotePanel } from '@/types/remote-panel';
import type { Edge, Node } from '@xyflow/react';

export interface LocalConnection {
  source: string;
  target: string;
}

interface FlowNodeArgs {
  localNodes: ChainBuilderNode[];
  topology: ChainTopology;
  customPositions: Record<string, { x: number; y: number }>;
  serverPanelMap?: Record<number, number>;
  panels?: RemotePanel[];
}

/**
 * Build React Flow nodes from chain builder nodes. When a server→panel map is
 * supplied, chain nodes are grouped under panel-group parent nodes; otherwise
 * plain chain nodes are returned (backward compatible).
 */
export function buildFlowNodes({
  localNodes,
  topology,
  customPositions,
  serverPanelMap,
  panels,
}: FlowNodeArgs): Node[] {
  const positions = getDefaultPositions(localNodes.length, topology);
  const mergedPositions = { ...positions, ...customPositions };

  if (!serverPanelMap) {
    return toFlowNodes(localNodes, mergedPositions);
  }

  const panelGroups = new Map<
    number,
    {
      panelId: number;
      panelName: string;
      isActive: boolean;
      nodeIds: string[];
    }
  >();

  for (const node of localNodes) {
    if (node.serverId === null) continue;
    const panelId = serverPanelMap[node.serverId];
    if (panelId === undefined) continue;
    let group = panelGroups.get(panelId);
    if (!group) {
      const panel = panels?.find((p) => p.id === panelId);
      group = {
        panelId,
        panelName: panel?.name ?? `Panel ${panelId}`,
        isActive: panel?.isActive ?? false,
        nodeIds: [],
      };
      panelGroups.set(panelId, group);
    }
    group.nodeIds.push(node.id);
  }

  const chainNodes = localNodes.map((builderNode) => {
    let panelId: number | undefined;
    if (builderNode.serverId !== null) {
      panelId = serverPanelMap[builderNode.serverId];
    }

    return {
      id: builderNode.id,
      type: 'chainNode' as const,
      position: mergedPositions[builderNode.id] ?? {
        x: CANVAS_PADDING,
        y: CANVAS_PADDING,
      },
      data: { ...builderNode },
      parentId: panelId !== undefined ? `panel-group-${panelId}` : undefined,
      className:
        panelId === undefined
          ? 'ring-1 ring-dashed ring-yellow-500/30'
          : undefined,
    };
  });

  const groupNodes = Array.from(panelGroups.values()).map((group) => ({
    id: `panel-group-${group.panelId}`,
    type: 'group' as const,
    position: { x: 0, y: 0 },
    data: {
      panelId: group.panelId,
      panelName: group.panelName,
      isActive: group.isActive,
    },
    style: { padding: 16 },
    className:
      'bg-card/20 border-2 border-dashed border-muted-foreground/40 rounded-lg',
  }));

  return [...groupNodes, ...chainNodes];
}

interface FlowEdgeArgs {
  localConnections: LocalConnection[];
  localNodes: ChainBuilderNode[];
  serverPanelMap?: Record<number, number>;
  panels?: RemotePanel[];
}

export function buildFlowEdges({
  localConnections,
  localNodes,
  serverPanelMap,
  panels,
}: FlowEdgeArgs): Edge[] {
  const isCrossPanel = (sourceId: string, targetId: string) => {
    if (!serverPanelMap) return false;
    const sourceNode = localNodes.find((n) => n.id === sourceId);
    const targetNode = localNodes.find((n) => n.id === targetId);
    if (!sourceNode?.serverId || !targetNode?.serverId) return false;
    const sourcePanel = serverPanelMap[sourceNode.serverId];
    const targetPanel = serverPanelMap[targetNode.serverId];
    return (
      sourcePanel !== undefined &&
      targetPanel !== undefined &&
      sourcePanel !== targetPanel
    );
  };

  return toFlowEdges(
    localConnections.map((c) => ({ fromId: c.source, toId: c.target })),
    isCrossPanel,
    { panels, serverPanelMap, builderNodes: localNodes },
  );
}
