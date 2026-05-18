'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import {
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronUp,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChainNode } from '@/types/chain';

interface ChainNodeCardProps {
  node: ChainNode;
  index: number;
  serverName?: string;
  hostname?: string;
  isActive?: boolean;
  canRemove: boolean;
  onRemove?: () => void;
  onDragStart?: (index: number, e: React.MouseEvent) => void;
}

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

export function ChainNodeCard({
  node,
  index,
  serverName,
  hostname,
  isActive = true,
  canRemove,
  onRemove,
  onDragStart,
}: ChainNodeCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={clsx(
        'w-48 rounded-lg border bg-card text-card-foreground shadow-md',
        'transition-shadow hover:shadow-lg',
        isActive ? 'border-border' : 'border-destructive/50 opacity-60',
      )}
    >
      {/* Drag handle header */}
      <div
        className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-xs text-muted-foreground"
        onMouseDown={(e) => onDragStart?.(index, e)}
      >
        <GripVertical className="h-3.5 w-3.5 cursor-grab" />
        <span className="font-medium">Node {index + 1}</span>
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
          <div
            className={clsx(
              'h-2 w-2 rounded-full',
              isActive ? 'bg-green-400' : 'bg-red-400',
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {serverName || node.label}
            </p>
            {hostname && (
              <p className="truncate text-xs text-muted-foreground">
                {hostname}
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

      {/* Config expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={clsx(
          'flex w-full items-center justify-center gap-1 border-t border-border px-3 py-1.5 text-xs text-muted-foreground',
          'transition-colors hover:bg-muted',
        )}
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3 w-3" />
            Hide config
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" />
            Show config
          </>
        )}
      </button>

      {/* Expanded config area */}
      {expanded && (
        <div className="border-t border-border bg-muted/30 px-3 py-2">
          <pre className="overflow-x-auto text-[10px] text-muted-foreground">
            {JSON.stringify(
              {
                label: node.label,
                role: node.role,
                protocol: node.protocol,
                serverId: node.serverId,
                hostname: hostname ?? 'not assigned',
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}

      {/* Remove button */}
      {canRemove && onRemove && (
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
