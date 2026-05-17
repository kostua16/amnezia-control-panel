'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { Plus, Save, GitBranch, Globe, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ChainNodeCard } from './chain-node';
import { ChainTemplatesList } from './chain-templates-list';
import {
  calculateNodePositions,
  calculateConnections,
  NODE_WIDTH,
  NODE_HEIGHT,
} from '@/lib/chain-layout';
import type { ChainNode, ChainTopology, ChainTemplate } from '@/types/chain';
import type { Server } from '@/types/server';

interface ChainBuilderNode {
  id: string;
  serverId: number | null;
  label: string;
  role: ChainNode['role'];
  protocol: ChainNode['protocol'];
}

interface ChainBuilderProps {
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

export function ChainBuilder({ servers, onApply }: ChainBuilderProps) {
  const [topology, setTopology] = useState<ChainTopology>('linear');
  const [nodes, setNodes] = useState<ChainBuilderNode[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ChainTemplate | null>(null);
  const [showTemplates, setShowTemplates] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [saving, setSaving] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [customPositions, setCustomPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const svgRef = useRef<SVGSVGElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

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
    setNodes(newNodes);
    setCustomPositions({});
    setShowTemplates(false);
  }, []);

  const handleAddNode = useCallback(
    (serverId: number) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;

      const newNode: ChainBuilderNode = {
        id: `node-${Date.now()}`,
        serverId,
        label: server.name,
        role: nodes.length === 0 ? 'entry' : nodes.length === 1 ? 'exit' : 'middle',
        protocol: 'wireguard',
      };
      setNodes((prev) => [...prev, newNode]);
      setShowAddMenu(false);
    },
    [servers, nodes.length],
  );

  const handleRemoveNode = useCallback((index: number) => {
    setNodes((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Reassign roles
      if (next.length > 0) {
        next[0] = { ...next[0], role: 'entry' };
        if (next.length > 1) {
          next[next.length - 1] = { ...next[next.length - 1], role: 'exit' };
          for (let i = 1; i < next.length - 1; i++) {
            next[i] = { ...next[i], role: 'middle' };
          }
        }
      }
      return next;
    });
  }, []);

  const handleAssignServer = useCallback(
    (nodeIndex: number, serverId: number) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;
      setNodes((prev) =>
        prev.map((n, i) =>
          i === nodeIndex
            ? { ...n, serverId, label: server.name }
            : n,
        ),
      );
    },
    [servers],
  );

  const handleDragStart = useCallback(
    (index: number, e: React.MouseEvent) => {
      const node = nodes[index];
      const pos = customPositions[node.id];
      if (pos) {
        setDragIndex(index);
        setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
      }
    },
    [nodes, customPositions],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (dragIndex === null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - dragOffset.x;
      const y = e.clientY - rect.top - dragOffset.y;
      const node = nodes[dragIndex];
      if (!node) return;
      setCustomPositions((prev) => ({
        ...prev,
        [node.id]: { x, y },
      }));
    },
    [dragIndex, dragOffset, nodes],
  );

  const handleMouseUp = useCallback(() => {
    setDragIndex(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (nodes.length === 0) return;
    setSaving(true);
    try {
      const assignedNodes = nodes.filter((n): n is ChainBuilderNode & { serverId: number } => n.serverId !== null);
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
  }, [nodes, selectedTemplate, onApply]);

  // Calculate layout positions
  const layoutNodes = nodes.map((n) => ({ id: n.id, label: n.label }));
  const basePositions = calculateNodePositions(layoutNodes, topology);
  const positions = basePositions.map((pos) => ({
    ...pos,
    ...(customPositions[pos.id] ?? {}),
  }));
  const connections = calculateConnections(positions, topology);
  const posLookup = new Map(positions.map((p) => [p.id, p]));

  // Determine SVG canvas size
  const maxX = positions.length > 0
    ? Math.max(...positions.map((p) => p.x)) + NODE_WIDTH + 40
    : 600;
  const maxY = positions.length > 0
    ? Math.max(...positions.map((p) => p.y)) + NODE_HEIGHT + 40
    : 200;

  return (
    <div className="space-y-4">
      {/* Topology selector */}
      <div className="flex items-center gap-2">
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
      </div>

      {/* Template selector */}
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

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowTemplates(!showTemplates)}>
          Templates
        </Button>

        {/* Add node dropdown */}
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

        {/* Save chain */}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={nodes.length === 0 || saving}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save Chain'}
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Canvas area */}
      <div
        className="relative overflow-auto rounded-lg border border-border bg-muted/30"
        style={{ minHeight: '300px' }}
      >
        <svg
          ref={svgRef}
          width={maxX}
          height={maxY}
          className={clsx(dragIndex !== null && 'cursor-grabbing')}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Connection lines */}
          {connections.map((conn, i) => {
            const fromPos = posLookup.get(conn.from);
            const toPos = posLookup.get(conn.to);
            if (!fromPos || !toPos) return null;
            const fromX = fromPos.x + NODE_WIDTH / 2;
            const fromY = fromPos.y + NODE_HEIGHT / 2;
            const toX = toPos.x + NODE_WIDTH / 2;
            const toY = toPos.y + NODE_HEIGHT / 2;
            const midX = (fromX + toX) / 2;

            return (
              <path
                key={`conn-${i}`}
                d={
                  topology === 'linear'
                    ? `M ${fromX} ${fromY} L ${toX} ${toY}`
                    : `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
                }
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray="6 3"
                className="text-muted-foreground/50"
              />
            );
          })}

          {/* Arrowheads */}
          {connections.map((conn, i) => {
            const fromPos = posLookup.get(conn.from);
            const toPos = posLookup.get(conn.to);
            if (!fromPos || !toPos) return null;
            const fromX = fromPos.x + NODE_WIDTH / 2;
            const fromY = fromPos.y + NODE_HEIGHT / 2;
            const toX = toPos.x + NODE_WIDTH / 2;
            const toY = toPos.y + NODE_HEIGHT / 2;

            const dx = toX - fromX;
            const dy = toY - fromY;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len === 0) return null;

            const ux = dx / len;
            const uy = dy / len;
            const arrowSize = 8;
            const tipX = toX - ux * (NODE_WIDTH / 2 + 4);
            const tipY = toY - uy * (NODE_HEIGHT / 2 + 4);

            return (
              <polygon
                key={`arrow-${i}`}
                points={`
                  ${tipX},${tipY}
                  ${tipX - ux * arrowSize - uy * arrowSize / 2},${tipY - uy * arrowSize + ux * arrowSize / 2}
                  ${tipX - ux * arrowSize + uy * arrowSize / 2},${tipY - uy * arrowSize - ux * arrowSize / 2}
                `}
                className="fill-muted-foreground/50"
              />
            );
          })}
        </svg>

        {/* Node cards overlaid on SVG */}
        {nodes.map((node, index) => {
          const pos = positions.find((p) => p.id === node.id);
          if (!pos) return null;
          const server = node.serverId
            ? servers.find((s) => s.id === node.serverId)
            : undefined;

          return (
            <div
              key={node.id}
              className="absolute"
              style={{ left: pos.x, top: pos.y }}
            >
              <ChainNodeCard
                node={{
                  label: node.label,
                  serverId: node.serverId ?? 0,
                  role: node.role,
                  protocol: node.protocol,
                }}
                index={index}
                serverName={server?.name}
                hostname={server?.hostname}
                isActive={server?.isActive}
                canRemove={nodes.length > 1}
                onRemove={() => handleRemoveNode(index)}
                onDragStart={handleDragStart}
              />

              {/* Server assignment dropdown (when no server assigned) */}
              {!node.serverId && (
                <select
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAssignServer(index, Number(e.target.value));
                    }
                  }}
                >
                  <option value="" disabled>
                    Assign server...
                  </option>
                  {servers
                    .filter(
                      (s) =>
                        !nodes.some(
                          (n, ni) => ni !== index && n.serverId === s.id,
                        ),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.hostname})
                      </option>
                    ))}
                </select>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <GitBranch className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
              <p>Select a template or add nodes to build a chain</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
