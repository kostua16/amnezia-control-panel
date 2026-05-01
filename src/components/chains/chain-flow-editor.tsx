'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import { Plus, Save, GitBranch, Globe, Network, Loader2 } from 'lucide-react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ChainFlowNode } from './chain-flow-node';
import { ChainTemplatesList } from './chain-templates-list';
import {
  toFlowNodes,
  toFlowEdges,
  getDefaultPositions,
  reassignRoles,
  generateNodeId,
  type ChainBuilderNode,
} from '@/lib/chain-flow-utils';
import type { ChainTopology, ChainTemplate } from '@/types/chain';
import type { Server } from '@/types/server';

interface ChainFlowEditorProps {
  servers: Server[];
  onApply?: (templateId: string, serverMapping: Record<number, number>) => void;
}

const topologyOptions: Array<{
  value: ChainTopology;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'linear', label: 'Linear', icon: GitBranch },
  { value: 'split', label: 'Split', icon: Globe },
  { value: 'mesh', label: 'Mesh', icon: Network },
];

const defaultEdgeOptions: Partial<Edge> = {
  type: 'smoothstep',
  animated: false,
  style: { stroke: '#94a3b8', strokeWidth: 1.5 },
};

export function ChainFlowEditor({ servers, onApply }: ChainFlowEditorProps) {
  const [topology, setTopology] = useState<ChainTopology>('linear');
  const [localNodes, setLocalNodes] = useState<ChainBuilderNode[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ChainTemplate | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customPositions, setCustomPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Register custom node types (memoized)
  const nodeTypes = useMemo(() => ({ chainNode: ChainFlowNode }), []);

  // Convert local nodes to React Flow nodes/edges
  const flowNodes = useMemo(() => {
    const positions = getDefaultPositions(localNodes.length, topology);
    const mergedPositions = { ...positions, ...customPositions };
    return toFlowNodes(localNodes, mergedPositions);
  }, [localNodes, topology, customPositions]);

  const flowEdges = useMemo(() => {
    return toFlowEdges(
      localConnections.map((c) => ({ fromId: c.source, toId: c.target })),
    );
  }, [localConnections]);

  // Use React Flow state hooks
  const [reactFlowNodes, setReactFlowNodes, onNodesChange] = useNodesState(flowNodes);
  const [reactFlowEdges, setReactFlowEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Track connections locally (React Flow edges are the source of truth for display)
  const [localConnections, setLocalConnections] = useState<
    Array<{ source: string; target: string }>
  >([]);

  // Sync React Flow nodes to local nodes when positions change
  const prevNodesRef = useRef(reactFlowNodes);
  useEffect(() => {
    const prev = prevNodesRef.current;
    if (prev !== reactFlowNodes) {
      // Detect position changes from React Flow DnD and store them
      for (const node of reactFlowNodes) {
        if (node.position) {
          setCustomPositions((prev) => {
            if (
              prev[node.id] &&
              prev[node.id].x === node.position.x &&
              prev[node.id].y === node.position.y
            ) {
              return prev;
            }
            return { ...prev, [node.id]: { x: node.position.x, y: node.position.y } };
          });
        }
      }
      prevNodesRef.current = reactFlowNodes;
    }
  }, [reactFlowNodes]);

  // Sync flowNodes/flowEdges changes to React Flow state
  useEffect(() => {
    setReactFlowNodes(flowNodes);
  }, [flowNodes, setReactFlowNodes]);

  useEffect(() => {
    setReactFlowEdges(flowEdges);
  }, [flowEdges, setReactFlowEdges]);

  // Close add menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Connection handler
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return; // Reject self-connections

      // Check for duplicate connections
      const exists = localConnections.some(
        (c) =>
          c.source === connection.source && c.target === connection.target,
      );
      if (exists) return;

      const newConn = { source: connection.source, target: connection.target };
      setLocalConnections((prev) => [...prev, newConn]);
    },
    [localConnections],
  );

  // Node deletion handler
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const deletedIds = new Set(deleted.map((n) => n.id));
      setLocalNodes((prev) => {
        const remaining = prev.filter((n) => !deletedIds.has(n.id));
        return reassignRoles(remaining);
      });
      setLocalConnections((prev) =>
        prev.filter((c) => !deletedIds.has(c.source) && !deletedIds.has(c.target)),
      );
      setCustomPositions((prev) => {
        const next = { ...prev };
        for (const id of deletedIds) {
          delete next[id];
        }
        return next;
      });
    },
    [],
  );

  // Edge deletion handler
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const deletedIds = new Set(deleted.map((e) => e.id));
    setLocalConnections((prev) =>
      prev.filter((c) => !deletedIds.has(`edge-${c.source}-${c.target}`)),
    );
  }, []);

  // Template selection
  const handleSelectTemplate = useCallback((template: ChainTemplate) => {
    setSelectedTemplate(template);
    setTopology(template.topology);
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
    setShowTemplates(false);
  }, []);

  // Add node
  const handleAddNode = useCallback(
    (serverId: number) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;

      const newNode: ChainBuilderNode = {
        id: generateNodeId(),
        serverId,
        label: server.name,
        role: localNodes.length === 0 ? 'entry' : localNodes.length === 1 ? 'exit' : 'middle',
        protocol: 'wireguard',
      };
      setLocalNodes((prev) => {
        const next = [...prev, newNode];
        return reassignRoles(next);
      });
      setShowAddMenu(false);
    },
    [servers, localNodes.length],
  );

  // Save chain
  const handleSave = useCallback(async () => {
    if (localNodes.length === 0) return;
    setSaving(true);
    try {
      const assignedNodes = localNodes.filter(
        (n): n is ChainBuilderNode & { serverId: number } => n.serverId !== null,
      );
      const serverMapping = Object.fromEntries(
        assignedNodes.map((n, i) => [i, n.serverId] as const),
      ) as Record<number, number>;

      const response = await fetch('/api/chains/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate?.id ?? 'custom',
          serverMapping,
        }),
      });
      const result = await response.json();
      if (result.success && onApply) {
        onApply(selectedTemplate?.id ?? 'custom', serverMapping);
      }
    } finally {
      setSaving(false);
    }
  }, [localNodes, selectedTemplate, onApply]);

  // Keyboard: Delete for selected nodes/edges
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
          return;
        }
        // React Flow handles deletion internally via onNodesDelete/onEdgesDelete
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Topology selector */}
        {topologyOptions.map((opt) => {
          const Icon = opt.icon;
          return (
            <Button
              key={opt.value}
              variant={topology === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setTopology(opt.value);
                setCustomPositions({});
              }}
            >
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {opt.label}
            </Button>
          );
        })}

        {/* Templates toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTemplates(!showTemplates)}
        >
          Templates
        </Button>

        {/* Add Node dropdown */}
        <div className="relative" ref={addMenuRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddMenu(!showAddMenu)}
            disabled={servers.length === 0}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Node
          </Button>
          {showAddMenu && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card shadow-lg">
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
                Available Servers
              </div>
              {servers.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No servers configured
                </div>
              )}
              {servers.map((server) => (
                <button
                  key={server.id}
                  onClick={() => handleAddNode(server.id)}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    'transition-colors hover:bg-muted',
                  )}
                >
                  <div
                    className={clsx(
                      'h-2 w-2 rounded-full',
                      server.isActive ? 'bg-green-400' : 'bg-red-400',
                    )}
                  />
                  <span>{server.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {server.hostname}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Save Chain */}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={localNodes.length === 0 || saving}
        >
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          {saving ? 'Saving...' : 'Save Chain'}
        </Button>

        {/* Node count */}
        <span className="ml-auto text-xs text-muted-foreground">
          {localNodes.length} node{localNodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Template selector panel */}
      {showTemplates && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Choose a template</CardTitle>
          </CardHeader>
          <CardContent>
            <ChainTemplatesList
              selectedId={selectedTemplate?.id}
              onSelect={handleSelectTemplate}
              filterTopology={topology}
            />
          </CardContent>
        </Card>
      )}

      {/* React Flow Canvas */}
      <div className="relative h-[500px] rounded-lg border border-border">
        <ReactFlow
          nodes={reactFlowNodes}
          edges={reactFlowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          minZoom={0.3}
          maxZoom={2}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Controls position="bottom-right" />
          <MiniMap position="bottom-left" />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#334155"
          />
        </ReactFlow>

        {/* Empty state overlay */}
        {localNodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <h3 className="mb-1 text-sm text-muted-foreground">
                No chain topology yet
              </h3>
              <p className="mb-3 max-w-xs text-xs text-muted-foreground">
                Select a template or add nodes to build a chain. Drag from a node
                handle to connect it to another node.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="pointer-events-auto"
                onClick={() => setShowAddMenu(true)}
                disabled={servers.length === 0}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Node
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
