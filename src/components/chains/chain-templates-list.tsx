'use client';

import { clsx } from 'clsx';
import { Shield, Globe, RefreshCw } from 'lucide-react';
import type { ChainTemplate, ChainTopology } from '@/types/chain';
import { BUILTIN_CHAIN_TEMPLATES } from '@/lib/chain-templates';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield,
  Globe,
  RefreshCw,
};

const topologyLabel: Record<ChainTopology, string> = {
  linear: 'Linear',
  split: 'Split',
  mesh: 'Mesh',
};

interface ChainTemplatesListProps {
  selectedId?: string;
  onSelect: (template: ChainTemplate) => void;
  filterTopology?: ChainTopology;
}

export function ChainTemplatesList({
  selectedId,
  onSelect,
  filterTopology,
}: ChainTemplatesListProps) {
  const templates = filterTopology
    ? BUILTIN_CHAIN_TEMPLATES.filter((t) => t.topology === filterTopology)
    : BUILTIN_CHAIN_TEMPLATES;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {templates.map((template) => {
        const Icon = iconMap[template.icon] ?? Shield;
        const isSelected = selectedId === template.id;

        return (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className={clsx(
              'flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-all',
              isSelected
                ? 'border-accent bg-accent/10 shadow-md'
                : 'border-border bg-card hover:border-accent/50 hover:bg-muted/50',
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-md',
                  isSelected ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">{template.name}</p>
                <p className="text-xs text-muted-foreground">
                  {topologyLabel[template.topology]}
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              {template.description}
            </p>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-0.5">
                {template.requiredServers} server{template.requiredServers > 1 ? 's' : ''}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5">
                {template.nodes.length} node{template.nodes.length > 1 ? 's' : ''}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
