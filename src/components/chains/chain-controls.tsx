'use client';

import { RefObject } from 'react';
import { Plus, Save, GitBranch, Globe, Network } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import type { ChainTopology } from '@/types/chain';
import type { Server } from '@/types/server';

const topologyOptions: Array<{
  value: ChainTopology;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'linear', label: 'Linear', icon: GitBranch },
  { value: 'split', label: 'Split', icon: Globe },
  { value: 'mesh', label: 'Mesh', icon: Network },
];

interface ChainControlsProps {
  topology: ChainTopology;
  onTopologyChange: (value: ChainTopology) => void;
  onToggleTemplates: () => void;
  showAddMenu: boolean;
  onToggleAddMenu: () => void;
  addMenuRef: RefObject<HTMLDivElement | null>;
  servers: Server[];
  onAddNode: (serverId: number) => void;
  onSave: () => void;
  nodeCount: number;
}

export function ChainControls({
  topology,
  onTopologyChange,
  onToggleTemplates,
  showAddMenu,
  onToggleAddMenu,
  addMenuRef,
  servers,
  onAddNode,
  onSave,
  nodeCount,
}: ChainControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Topology selector */}
      {topologyOptions.map((opt) => {
        const Icon = opt.icon;
        return (
          <Button
            key={opt.value}
            variant={topology === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onTopologyChange(opt.value)}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" />
            {opt.label}
          </Button>
        );
      })}

      {/* Templates toggle */}
      <Button variant="outline" size="sm" onClick={onToggleTemplates}>
        Templates
      </Button>

      {/* Add Node dropdown */}
      <div className="relative" ref={addMenuRef}>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleAddMenu}
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
                onClick={() => onAddNode(server.id)}
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
      <Button size="sm" onClick={onSave} disabled={nodeCount === 0}>
        <Save className="mr-1.5 h-3.5 w-3.5" />
        Save Chain
      </Button>

      {/* Node count */}
      <span className="ml-auto text-xs text-muted-foreground">
        {nodeCount} node{nodeCount !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
