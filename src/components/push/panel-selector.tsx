'use client';

import { useState, useEffect, useMemo } from 'react';
import { Monitor, CheckSquare, Search, Eye, EyeOff } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { PanelStatusBadge } from '@/components/panels/panel-status-badge';
import type { PanelConnectionStatus } from '@/lib/panel-health-checker';

interface PanelSelectorPanel {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
}

interface PanelSelectorProps {
  panels: PanelSelectorPanel[];
  selectedPanelIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  panelApiKeys?: Record<number, string>;
  onApiKeyChange?: (panelId: number, apiKey: string) => void;
}

export function PanelSelector({
  panels,
  selectedPanelIds,
  onSelectionChange,
  panelApiKeys = {},
  onApiKeyChange,
}: PanelSelectorProps) {
  const [search, setSearch] = useState('');
  const [visibleKeys, setVisibleKeys] = useState<Record<number, boolean>>({});
  const [panelStatuses, setPanelStatuses] = useState<Record<number, PanelConnectionStatus>>({});

  // Fetch panel statuses
  useEffect(() => {
    async function fetchStatuses() {
      const statuses: Record<number, PanelConnectionStatus> = {};
      for (const panel of panels) {
        try {
          const res = await fetch(`/api/panels/${panel.id}/status`);
          const json = await res.json();
          if (json.success) {
            statuses[panel.id] = json.data.status;
          }
        } catch {
          // Non-critical
        }
      }
      setPanelStatuses(statuses);
    }
    fetchStatuses();
  }, [panels]);

  // Pre-select all connected panels on mount
  useEffect(() => {
    if (selectedPanelIds.size === 0 && Object.keys(panelStatuses).length > 0) {
      const connectedIds = new Set<number>();
      for (const [id, status] of Object.entries(panelStatuses)) {
        if (status === 'connected') {
          connectedIds.add(Number(id));
        }
      }
      if (connectedIds.size > 0) {
        onSelectionChange(connectedIds);
      }
    }
    // Only run once when statuses load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelStatuses]);

  const filteredPanels = useMemo(() => {
    if (!search.trim()) return panels;
    const q = search.toLowerCase();
    return panels.filter((p) => p.name.toLowerCase().includes(q));
  }, [panels, search]);

  const connectedPanels = panels.filter(
    (p) => panelStatuses[p.id] === 'connected' && p.isActive,
  );

  const handleToggle = (panelId: number, status: PanelConnectionStatus) => {
    if (status === 'offline') return; // Disabled for offline panels
    const next = new Set(selectedPanelIds);
    if (next.has(panelId)) {
      next.delete(panelId);
    } else {
      next.add(panelId);
    }
    onSelectionChange(next);
  };

  const handleSelectAllConnected = () => {
    const ids = new Set<number>();
    for (const panel of connectedPanels) {
      ids.add(panel.id);
    }
    onSelectionChange(ids);
  };

  if (panels.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-1">
            No panels registered
          </p>
          <p className="text-sm text-muted-foreground">
            No panels registered. Add panels from the Panels page.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Select Panels</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectAllConnected}
            className="text-xs"
          >
            <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
            Select all connected
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Select panels to push to..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="space-y-2">
          {filteredPanels.map((panel) => {
            const status = panelStatuses[panel.id] ?? 'unknown';
            const isSelected = selectedPanelIds.has(panel.id);
            const isOffline = status === 'offline';
            const isDisabled = isOffline || !panel.isActive;

            return (
              <label
                key={panel.id}
                className={clsx(
                  'flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors',
                  isSelected
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:bg-muted/50',
                  isDisabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => handleToggle(panel.id, status)}
                  className="h-4 w-4 rounded border-border"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium text-sm truncate">{panel.name}</span>
                    <PanelStatusBadge status={status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {panel.panelUrl}
                  </p>
                </div>
              </label>
              {isSelected && onApiKeyChange && (
                <div className="mt-2 ml-8 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={visibleKeys[panel.id] ? 'text' : 'password'}
                      placeholder={`Enter shared secret for ${panel.name}`}
                      value={panelApiKeys[panel.id] ?? ''}
                      onChange={(e) => onApiKeyChange(panel.id, e.target.value)}
                      className="pr-9 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setVisibleKeys(prev => ({ ...prev, [panel.id]: !prev[panel.id] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={visibleKeys[panel.id] ? 'Hide API key' : 'Show API key'}
                    >
                      {visibleKeys[panel.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}
            );
          })}
        </div>

        {filteredPanels.length === 0 && search && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No panels match &quot;{search}&quot;
          </p>
        )}
      </CardContent>
    </Card>
  );
}
