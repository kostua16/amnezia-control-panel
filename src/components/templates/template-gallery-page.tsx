'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ProtocolTemplatesGrid } from '@/components/templates/protocol-templates-grid';
import { ServerPresetsGrid } from '@/components/templates/server-presets-grid';
import { RoutingPresetsGrid } from '@/components/templates/routing-presets-grid';
import { ChainPresetsGrid } from '@/components/templates/chain-presets-grid';
import type { ConfigTemplate, ConfigPreset } from '@/types/config';
import type { RoutingRuleTemplate } from '@/types/routing-rule-template';
import type { ChainPreset } from '@/types/chain-preset';

const TABS = [
  { value: 'protocols', label: 'Protocols' },
  { value: 'server', label: 'Server' },
  { value: 'routing', label: 'Routing' },
  { value: 'chain', label: 'Chain' },
] as const;

type PreviewItem = {
  type: 'protocol';
  data: ConfigTemplate;
} | {
  type: 'server';
  data: ConfigPreset;
} | {
  type: 'routing';
  data: RoutingRuleTemplate;
} | {
  type: 'chain';
  data: ChainPreset;
};

export function TemplateGalleryPage() {
  const [activeTab, setActiveTab] = useState<string>('protocols');
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null);

  const handlePreview = useCallback((type: string, data: unknown) => {
    setPreviewItem({ type: type as PreviewItem['type'], data } as PreviewItem);
  }, []);

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-md border border-border p-1">
        {TABS.map((tab) => (
          <Button
            key={tab.value}
            variant={activeTab === tab.value ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Content area */}
      <div>
        {activeTab === 'protocols' && <ProtocolTemplatesGrid onPreview={handlePreview} />}
        {activeTab === 'server' && <ServerPresetsGrid onPreview={handlePreview} />}
        {activeTab === 'routing' && <RoutingPresetsGrid onPreview={handlePreview} />}
        {activeTab === 'chain' && <ChainPresetsGrid onPreview={handlePreview} />}
      </div>

      {/* Preview modal -- wired in Plan 04 */}
    </div>
  );
}
