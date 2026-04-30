'use client';

import { clsx } from 'clsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ChainTemplate } from '@/types/chain';

interface ChainTemplateSelectorProps {
  templates: ChainTemplate[];
  selectedTemplate: ChainTemplate | null;
  panels: Array<{ id: number; name: string; panelUrl: string; isActive: boolean }>;
  panelMapping: Record<number, number>;
  onTemplateSelect: (template: ChainTemplate | null) => void;
  onPanelMappingChange: (mapping: Record<number, number>) => void;
}

const TOPOLOGY_BADGES: Record<string, string> = {
  linear: 'bg-blue-500/20 text-blue-400',
  split: 'bg-amber-500/20 text-amber-400',
  mesh: 'bg-green-500/20 text-green-400',
};

export function ChainTemplateSelector({
  templates,
  selectedTemplate,
  panels,
  panelMapping,
  onTemplateSelect,
  onPanelMappingChange,
}: ChainTemplateSelectorProps) {
  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <p className="text-muted-foreground text-sm">No chain templates available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Template selection section */}
      <div>
        <p className="text-sm uppercase tracking-wide text-muted-foreground mb-3">
          Chain Template
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    onTemplateSelect(null);
                    onPanelMappingChange({});
                  } else {
                    onTemplateSelect(template);
                    onPanelMappingChange({});
                  }
                }}
                className={clsx(
                  'flex flex-col text-left rounded-lg border p-4 transition-colors',
                  isSelected
                    ? 'ring-2 ring-accent border-accent bg-accent/5'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-sm text-foreground">{template.name}</span>
                  <span
                    className={clsx(
                      'text-xs px-1.5 py-0.5 rounded',
                      TOPOLOGY_BADGES[template.topology] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {template.topology}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {template.description}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {template.requiredServers} server{template.requiredServers > 1 ? 's' : ''} required
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Node-to-panel mapping section */}
      {selectedTemplate && (
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground mb-3">
            Node-to-Panel Mapping
          </p>
          <Card>
            <CardContent className="space-y-3 pt-6">
              {selectedTemplate.nodes.map((node, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {node.label}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {node.role}
                      </span>
                    </div>
                  </div>
                  <select
                    value={panelMapping[index] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const next = { ...panelMapping };
                      if (val === '') {
                        delete next[index];
                      } else {
                        next[index] = Number(val);
                      }
                      onPanelMappingChange(next);
                    }}
                    className="bg-card text-foreground border border-border rounded p-2 text-sm w-48"
                  >
                    <option value="">Select panel...</option>
                    {panels
                      .filter((p) => p.isActive)
                      .filter((p) => {
                        // Filter out panels already mapped to other nodes
                        return !Object.entries(panelMapping).some(
                          ([idx, panelId]) => Number(idx) !== index && panelId === p.id,
                        );
                      })
                      .map((panel) => (
                        <option key={panel.id} value={panel.id}>
                          {panel.name}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
