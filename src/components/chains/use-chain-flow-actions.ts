'use client';

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  startTransition,
} from 'react';
import {
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  reassignRoles,
  generateNodeId,
  type ChainBuilderNode,
} from '@/lib/chain-flow-utils';
import {
  buildFlowNodes,
  buildFlowEdges,
  type LocalConnection,
} from '@/components/chains/chain-flow-graph-builders';
import type { ChainTopology, ChainTemplate } from '@/types/chain';
import type { Server } from '@/types/server';
import type { RemotePanel } from '@/types/remote-panel';

interface UseChainFlowActionsArgs {
  servers: Server[];
  serverPanelMap?: Record<number, number>;
  panels?: RemotePanel[];
  /** Called when the Delete key removes a selected chain node. */
  onPromptDeleteNode?: (nodeId: string) => void;
}

export function useChainFlowActions({
  servers,
  serverPanelMap,
  panels,
  onPromptDeleteNode,
}: UseChainFlowActionsArgs) {
  const [topology, setTopologyState] = useState<ChainTopology>('linear');
  const [localNodes, setLocalNodes] = useState<ChainBuilderNode[]>([]);
  const [localConnections, setLocalConnections] = useState<LocalConnection[]>(
    [],
  );
  const [customPositions, setCustomPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [selectedTemplate, setSelectedTemplate] =
    useState<ChainTemplate | null>(null);

  const flowNodes: Node[] = useMemo(
    () =>
      buildFlowNodes({
        localNodes,
        topology,
        customPositions,
        serverPanelMap,
        panels,
      }),
    [localNodes, topology, customPositions, serverPanelMap, panels],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      buildFlowEdges({
        localConnections,
        localNodes,
        serverPanelMap,
        panels,
      }),
    [localConnections, localNodes, serverPanelMap, panels],
  );

  const [reactFlowNodes, setReactFlowNodes, onNodesChange] =
    useNodesState<Node>(flowNodes);
  const [reactFlowEdges, setReactFlowEdges, onEdgesChange] =
    useEdgesState(flowEdges);

  // Sync React Flow node DnD positions back into customPositions.
  const prevNodesRef = useRef(reactFlowNodes);
  useEffect(() => {
    const prev = prevNodesRef.current;
    if (prev !== reactFlowNodes) {
      startTransition(() => {
        for (const node of reactFlowNodes) {
          if (node.position) {
            setCustomPositions((p) => {
              if (
                p[node.id] &&
                p[node.id].x === node.position.x &&
                p[node.id].y === node.position.y
              ) {
                return p;
              }
              return {
                ...p,
                [node.id]: { x: node.position.x, y: node.position.y },
              };
            });
          }
        }
      });
      prevNodesRef.current = reactFlowNodes;
    }
  }, [reactFlowNodes]);

  useEffect(() => {
    setReactFlowNodes(flowNodes);
  }, [flowNodes, setReactFlowNodes]);

  useEffect(() => {
    setReactFlowEdges(flowEdges);
  }, [flowEdges, setReactFlowEdges]);

  // Connection handler
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return; // Reject self-connections

      const exists = localConnections.some(
        (c) => c.source === connection.source && c.target === connection.target,
      );
      if (exists) return;

      setLocalConnections((prev) => [
        ...prev,
        { source: connection.source, target: connection.target },
      ]);
    },
    [localConnections],
  );

  // Remove nodes by id and clean up their connections/positions, reassigning roles.
  const deleteNodes = useCallback((deletedIds: Set<string>) => {
    if (deletedIds.size === 0) return;
    setLocalNodes((prev) => {
      const remaining = prev.filter((n) => !deletedIds.has(n.id));
      return reassignRoles(remaining);
    });
    setLocalConnections((prev) =>
      prev.filter(
        (c) => !deletedIds.has(c.source) && !deletedIds.has(c.target),
      ),
    );
    setCustomPositions((prev) => {
      const next = { ...prev };
      for (const id of deletedIds) {
        delete next[id];
      }
      return next;
    });
  }, []);

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleteNodes(new Set(deleted.map((n) => n.id)));
    },
    [deleteNodes],
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const deletedIds = new Set(deleted.map((e) => e.id));
    setLocalConnections((prev) =>
      prev.filter((c) => !deletedIds.has(`edge-${c.source}-${c.target}`)),
    );
  }, []);

  const selectTemplate = useCallback((template: ChainTemplate) => {
    setSelectedTemplate(template);
    setTopologyState(template.topology);
    const newNodes: ChainBuilderNode[] = template.nodes.map((n, i) => ({
      id: `node-${i}`,
      serverId: null,
      label: n.label,
      role: n.role,
      protocol: n.protocol,
    }));
    setLocalNodes(newNodes);
    setLocalConnections([]);
    setCustomPositions({});
  }, []);

  const handleAddNode = useCallback(
    (serverId: number) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;

      const newNode: ChainBuilderNode = {
        id: generateNodeId(),
        serverId,
        label: server.name,
        role: 'middle',
        protocol: 'wireguard',
      };
      setLocalNodes((prev) => {
        // Role depends on the count at insertion time, matching the original logic.
        const count = prev.length;
        newNode.role = count === 0 ? 'entry' : count === 1 ? 'exit' : 'middle';
        const next = [...prev, newNode];
        return reassignRoles(next);
      });
    },
    [servers],
  );

  // Keyboard: Delete/Backspace prompts removal of the selected chain node.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT'
        ) {
          return;
        }
        const selectedNode = reactFlowNodes.find((n) => n.selected);
        if (selectedNode && selectedNode.type === 'chainNode') {
          e.preventDefault();
          onPromptDeleteNode?.(selectedNode.id);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reactFlowNodes, onPromptDeleteNode]);

  const setTopology = useCallback((value: ChainTopology) => {
    setTopologyState(value);
    setCustomPositions({});
  }, []);

  return {
    topology,
    setTopology,
    localNodes,
    localConnections,
    customPositions,
    setCustomPositions,
    selectedTemplate,
    setSelectedTemplate,
    selectTemplate,
    handleAddNode,
    onConnect,
    deleteNodes,
    onNodesDelete,
    onEdgesDelete,
    reactFlowNodes,
    reactFlowEdges,
    onNodesChange,
    onEdgesChange,
  };
}
