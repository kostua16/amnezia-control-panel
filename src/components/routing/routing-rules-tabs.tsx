'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { GeoRulesList } from '@/components/routing/geo-rules-list';
import { RoutingRulesList } from '@/components/routing/routing-rules-list';

const TABS = [
  { id: 'geo', label: 'Geo' },
  { id: 'ip-domain', label: 'IP & Domain' },
  { id: 'templates', label: 'Templates' },
] as const;

type TabId = typeof TABS[number]['id'];

export function RoutingRulesTabs() {
  const [activeTab, setActiveTab] = useState<TabId>('geo');

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div
        className="flex border-b border-border"
        role="tablist"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-b-2 border-accent text-accent'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'geo' && (
        <div role="tabpanel" aria-label="Geo routing rules">
          <GeoRulesList />
        </div>
      )}
      {activeTab === 'ip-domain' && (
        <div role="tabpanel" aria-label="IP and domain routing rules">
          <RoutingRulesList />
        </div>
      )}
      {activeTab === 'templates' && (
        <div role="tabpanel" aria-label="Routing rule templates">
          <div className="rounded-lg border border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Templates will be available in the Templates tab after setup.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
