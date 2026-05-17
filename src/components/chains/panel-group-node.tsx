'use client';

import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { clsx } from 'clsx';
import type { PanelGroupData } from '@/types/chain-flow';

function PanelGroupNodeRaw({
  data,
}: NodeProps<Node<PanelGroupData>>) {
  const { panelName, isActive } = data;

  return (
    <div
      role="group"
      aria-label={`${panelName} panel boundary`}
      className="pointer-events-none"
    >
      <div
        className={clsx(
          'absolute left-2 top-1 z-10 inline-flex items-center gap-1.5',
          'rounded bg-background/80 px-2 py-0.5',
          'text-xs font-medium text-muted-foreground',
        )}
      >
        <span
          className={clsx(
            'h-2 w-2 rounded-full',
            isActive ? 'bg-green-400' : 'bg-red-400',
          )}
        />
        {panelName}
      </div>
    </div>
  );
}

export const PanelGroupNode = memo(PanelGroupNodeRaw);
