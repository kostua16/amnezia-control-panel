'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { clsx } from 'clsx';
import { Server } from 'lucide-react';
import type { ChainBuilderNode } from '@/lib/chain-flow-utils';
import type { ChainNode } from '@/types/chain';

const roleLabels: Record<ChainNode['role'], string> = {
  entry: 'Entry',
  middle: 'Middle',
  exit: 'Exit',
  domestic: 'Domestic',
  foreign: 'Foreign',
};

const roleColors: Record<ChainNode['role'], string> = {
  entry: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  middle: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  exit: 'bg-green-500/20 text-green-400 border-green-500/30',
  domestic: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  foreign: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

const protocolBadge: Record<ChainNode['protocol'], string> = {
  wireguard: 'bg-emerald-500/20 text-emerald-300',
  xray: 'bg-sky-500/20 text-sky-300',
};

function ChainFlowNodeRaw({ data, selected }: NodeProps<{ data: ChainBuilderNode }>) {
  const node = data;

  return (
    <div
      className={clsx(
        'w-50 rounded-lg border bg-card text-card-foreground shadow-md',
        'transition-shadow',
        selected && 'ring-2 ring-accent/30 border-accent',
      )}
    >
      {/* Source handle -- top */}
      <Handle
        type="source"
        id="top"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !rounded-full !bg-accent !border-2 !border-background hover:!bg-accent/80 hover:!scale-110 transition-transform"
        aria-label={`Connect from ${node.label}`}
      />

      {/* Source handle -- bottom */}
      <Handle
        type="source"
        id="bottom"
        position={Position.Bottom}
        className="!w-2.5 !h-2.5 !rounded-full !bg-accent !border-2 !border-background hover:!bg-accent/80 hover:!scale-110 transition-transform"
        aria-label={`Connect from ${node.label}`}
      />

      {/* Target handle -- left */}
      <Handle
        type="target"
        id="left"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !rounded-full !bg-accent !border-2 !border-background hover:!bg-accent/80 hover:!scale-110 transition-transform"
        aria-label={`Connect to ${node.label}`}
      />

      {/* Target handle -- right */}
      <Handle
        type="target"
        id="right"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !rounded-full !bg-accent !border-2 !border-background hover:!bg-accent/80 hover:!scale-110 transition-transform"
        aria-label={`Connect to ${node.label}`}
      />

      {/* Header with role badge */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium">{node.label}</span>
        <span className="ml-auto">
          <span
            className={clsx(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase',
              roleColors[node.role],
            )}
          >
            {roleLabels[node.role]}
          </span>
        </span>
      </div>

      {/* Server info */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{node.label}</p>
            {node.serverId ? (
              <p className="truncate text-xs text-muted-foreground">
                Server #{node.serverId}
              </p>
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                Not assigned
              </p>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <Server className="h-3 w-3 text-muted-foreground" />
          <span
            className={clsx(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
              protocolBadge[node.protocol],
            )}
          >
            {node.protocol}
          </span>
        </div>
      </div>
    </div>
  );
}

export const ChainFlowNode = memo(ChainFlowNodeRaw);
