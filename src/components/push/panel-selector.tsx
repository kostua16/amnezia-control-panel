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

  // Fetch panel connection statuses on mount and when panels change
  useEffect(() => {
    const fetchStatuses = async () => {
      const statuses: Record<number, PanelConnectionStatus> = {};
      await Promise.all(
        panels.map(async (panel) => {
          try {
            const response = await fetch(`/api/panels/${panel.id}/health`);
            if (response.ok) {
              const data = await response.json();
              statuses[panel.id] = data.status;
            } else {
              statuses[panel.id] = 'unknown';
            }
          } catch {
            statuses[panel.id] = 'unknown';
          }
        })
      );
      setPanelStatuses(statuses);
    };

    void fetchStatuses();
  }, [panels]);

  const filteredPanels = useMemo(() => {
    if (!search) return panels;
    const lower = search.toLowerCase();
    return panels.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.panelUrl.toLowerCase().includes(lower)
    );
  }, [panels, search]);

  const handleToggle = (panelId: number, status: PanelConnectionStatus) => {
    if (status === 'offline') return;

    const next = new Set(selectedPanelIds);
    if (next.has(panelId)) {
      next.delete(panelId);
    } else {
      next.add(panelId);
    }
    onSelectionChange(next);
  };

  const handleSelectAll = () => {
    const available = filteredPanels.filter(
      (p) => panelStatuses[p.id] !== 'offline' && p.isActive
    );
    const allSelected = available.every((p) => selectedPanelIds.has(p.id));

    if (allSelected) {
      // Deselect all available
      const next = new Set(selectedPanelIds);
      for (const p of available) {
        next.delete(p.id);
      }
      onSelectionChange(next);
    } else {
      // Select all available
      onSelectionChange(new Set(available.map((p) => p.id)));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Select Target Panels</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectAll}
            className="text-xs"
          >
            <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
            Toggle All
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
              <div key={panel.id}>
                <label
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
              </div>
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
