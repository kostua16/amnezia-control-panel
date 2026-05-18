'use client';

import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Activity, Wifi, WifiOff } from 'lucide-react';
import { useChainStatus } from '@/hooks/use-chain-status';
import {
  calculateNodePositions,
  calculateConnections,
  NODE_WIDTH,
  NODE_HEIGHT,
} from '@/lib/chain-layout';

interface ChainVisualizationProps {
  chainId: string;
  /** Poll interval in ms. Default: 5000 */
  pollInterval?: number;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-400',
  degraded: 'bg-yellow-400',
  down: 'bg-red-400',
};

const statusGlow: Record<string, string> = {
  active: 'shadow-green-400/30',
  degraded: 'shadow-yellow-400/30',
  down: 'shadow-red-400/30',
};

function formatBytesPerSec(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024)
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function ChainVisualization({
  chainId,
  pollInterval,
}: ChainVisualizationProps) {
  const numericChainId = Number(chainId) || null;
  const { status, isLoading, error, refetch } = useChainStatus(numericChainId, {
    pollInterval,
    enabled: true,
  });
  const animFrameRef = useRef<number | null>(null);

  // Animated traffic dots using SVG
  useEffect(() => {
    if (!status) return;

    const dots = document.querySelectorAll<SVGCircleElement>('.traffic-dot');
    if (dots.length === 0) return;

    let offset = 0;
    const speed = 0.5; // pixels per frame

    function animate() {
      offset = (offset + speed) % 1000;
      for (const dot of dots) {
        dot.setAttribute('offset', String(offset / 10));
      }
      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [status]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-12 text-sm text-muted-foreground">
        <Activity className="mr-2 h-4 w-4 animate-pulse" />
        Loading chain status...
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 p-12 text-sm text-destructive">
        <WifiOff className="mr-2 h-4 w-4" />
        {error ?? 'No chain status available'}
        <button
          onClick={refetch}
          className="ml-3 rounded bg-destructive/10 px-2 py-1 text-xs hover:bg-destructive/20"
        >
          Retry
        </button>
      </div>
    );
  }

  // Calculate layout
  const layoutNodes = status.nodes.map((n) => ({ id: n.id, label: n.label }));
  const positions = calculateNodePositions(layoutNodes, status.topology);
  const connections = calculateConnections(positions, status.topology);

  // Build lookup maps
  const nodeLookup = new Map(status.nodes.map((n) => [n.id, n]));
  const posLookup = new Map(positions.map((p) => [p.id, p]));
  const connectionLookup = new Map(
    status.connections.map((c) => [`${c.fromNode}-${c.toNode}`, c]),
  );

  const isConnected = status !== null;

  // SVG dimensions
  const maxX =
    positions.length > 0
      ? Math.max(...positions.map((p) => p.x)) + NODE_WIDTH + 80
      : 600;
  const maxY =
    positions.length > 0
      ? Math.max(...positions.map((p) => p.y)) + NODE_HEIGHT + 80
      : 200;

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          {isConnected ? (
            <Wifi className="h-3.5 w-3.5 text-green-400" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-yellow-400" />
          )}
          <span>{isConnected ? 'Live' : 'Polling'}</span>
        </div>
        <span className="text-border">|</span>
        <span>
          {status.isActive ? (
            <span className="text-green-400">Active</span>
          ) : (
            <span className="text-red-400">Inactive</span>
          )}
        </span>
        <span className="text-border">|</span>
        <span>{status.nodes.length} nodes</span>
        <span className="text-border">|</span>
        <span>{status.connections.length} connections</span>
        <button
          onClick={refetch}
          className="ml-auto rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80"
        >
          Refresh
        </button>
      </div>

      {/* Visualization canvas */}
      <div
        className="relative overflow-auto rounded-lg border border-border bg-muted/30"
        style={{ minHeight: '250px' }}
      >
        <svg width={maxX} height={maxY} className="select-none">
          <defs>
            {/* Traffic flow gradient for animated dots */}
            <linearGradient id="traffic-flow">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="50%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>

          {/* Connection lines */}
          {connections.map((conn, i) => {
            const fromPos = posLookup.get(conn.from);
            const toPos = posLookup.get(conn.to);
            if (!fromPos || !toPos) return null;

            const fromX = fromPos.x + NODE_WIDTH / 2;
            const fromY = fromPos.y + NODE_HEIGHT / 2;
            const toX = toPos.x + NODE_WIDTH / 2;
            const toY = toPos.y + NODE_HEIGHT / 2;

            const connKey = `${conn.from}-${conn.to}`;
            const reverseKey = `${conn.to}-${conn.from}`;
            const metrics =
              connectionLookup.get(connKey) ?? connectionLookup.get(reverseKey);

            const midX = (fromX + toX) / 2;

            const pathD =
              status.topology === 'linear'
                ? `M ${fromX} ${fromY} L ${toX} ${toY}`
                : `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

            // Calculate midpoint for label placement
            const labelX = (fromX + toX) / 2;
            const labelY = (fromY + toY) / 2 - 12;

            return (
              <g key={`conn-${i}`}>
                {/* Background line */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="text-muted-foreground/30"
                />

                {/* Animated traffic overlay */}
                {metrics && metrics.trafficBytesPerSec > 0 && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke="url(#traffic-flow)"
                    strokeWidth={3}
                    strokeDasharray="10 90"
                    className="animate-pulse"
                    opacity={0.8}
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="100"
                      to="0"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </path>
                )}

                {/* Traffic and latency labels */}
                {metrics && (
                  <g>
                    {/* Background for readability */}
                    <rect
                      x={labelX - 40}
                      y={labelY - 10}
                      width={80}
                      height={20}
                      rx={4}
                      className="fill-background/80"
                    />
                    <text
                      x={labelX}
                      y={labelY + 2}
                      textAnchor="middle"
                      className="fill-foreground text-[10px]"
                    >
                      {formatBytesPerSec(metrics.trafficBytesPerSec)}
                    </text>

                    {/* Latency label below traffic */}
                    {metrics.latencyMs !== null && (
                      <>
                        <rect
                          x={labelX - 25}
                          y={labelY + 10}
                          width={50}
                          height={16}
                          rx={4}
                          className="fill-background/80"
                        />
                        <text
                          x={labelX}
                          y={labelY + 22}
                          textAnchor="middle"
                          className={clsx(
                            'text-[9px]',
                            metrics.latencyMs < 50
                              ? 'fill-green-400'
                              : metrics.latencyMs < 150
                                ? 'fill-yellow-400'
                                : 'fill-red-400',
                          )}
                        >
                          {metrics.latencyMs}ms
                        </text>
                      </>
                    )}
                  </g>
                )}

                {/* Arrowhead */}
                {(() => {
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
                      points={`
                        ${tipX},${tipY}
                        ${tipX - ux * arrowSize - (uy * arrowSize) / 2},${tipY - uy * arrowSize + (ux * arrowSize) / 2}
                        ${tipX - ux * arrowSize + (uy * arrowSize) / 2},${tipY - uy * arrowSize - (ux * arrowSize) / 2}
                      `}
                      className="fill-muted-foreground/40"
                    />
                  );
                })()}
              </g>
            );
          })}
        </svg>

        {/* Node cards */}
        {status.nodes.map((node) => {
          const pos = posLookup.get(node.id);
          if (!pos) return null;

          return (
            <div
              key={node.id}
              className={clsx(
                'absolute w-48 rounded-lg border bg-card p-3 shadow-md',
                'transition-shadow',
                statusColors[node.status]?.replace('bg-', 'border-') ??
                  'border-border',
                statusGlow[node.status] ?? '',
              )}
              style={{ left: pos.x, top: pos.y }}
            >
              <div className="flex items-center gap-2">
                <div
                  className={clsx(
                    'h-2.5 w-2.5 rounded-full',
                    statusColors[node.status],
                    node.status === 'active' && 'animate-pulse',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{node.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {node.hostname}
                  </p>
                </div>
              </div>

              {/* Latency */}
              {node.latencyMs !== null && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    Latency
                  </span>
                  <span
                    className={clsx(
                      'text-xs font-medium',
                      node.latencyMs < 50
                        ? 'text-green-400'
                        : node.latencyMs < 150
                          ? 'text-yellow-400'
                          : 'text-red-400',
                    )}
                  >
                    {node.latencyMs}ms
                  </span>
                </div>
              )}

              {/* Status indicator */}
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  Status
                </span>
                <span
                  className={clsx(
                    'text-[10px] font-semibold uppercase',
                    node.status === 'active'
                      ? 'text-green-400'
                      : node.status === 'degraded'
                        ? 'text-yellow-400'
                        : 'text-red-400',
                  )}
                >
                  {node.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
