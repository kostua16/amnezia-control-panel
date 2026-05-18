'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Package, Shield, Globe, GitBranch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ChainPreset } from '@/types/chain-preset';

interface ChainPresetsGridProps {
  onPreview: (type: string, data: unknown) => void;
  onFork?: (name: string, description: string) => void;
}

const topologyBadgeClasses: Record<string, string> = {
  linear: 'bg-blue-500/10 text-blue-400',
  split: 'bg-amber-500/10 text-amber-400',
  mesh: 'bg-green-500/10 text-green-400',
};

const topologyLabels: Record<string, string> = {
  linear: 'Linear',
  split: 'Split',
  mesh: 'Mesh',
};

export function ChainPresetsGrid({ onPreview, onFork }: ChainPresetsGridProps) {
  const [presets, setPresets] = useState<ChainPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState<number | null>(null);

  const fetchPresets = useCallback(async () => {
    try {
      const response = await fetch('/api/chain-presets');
      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Failed to fetch presets');
        return;
      }

      setPresets(result.data);
      setError(null);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/chain-presets/seed', { method: 'POST' }).catch(() => {});
    fetchPresets();
  }, [fetchPresets]);

  const handleApply = useCallback(async (presetId: number) => {
    setApplyLoading(presetId);
    setError(null);

    try {
      const response = await fetch('/api/chain-presets/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Failed to apply preset');
        return;
      }
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setApplyLoading(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading templates...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {presets.length === 0 && !error && (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Package className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            No templates available
          </h3>
          <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
            Built-in chain presets will appear here. Try refreshing the page.
          </p>
          <div className="mt-6">
            <Button variant="outline" onClick={fetchPresets}>
              Refresh Templates
            </Button>
          </div>
        </div>
      )}

      {presets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map((preset) => (
            <Card
              key={preset.id}
              className="hover:border-accent/50 transition-colors"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{preset.name}</CardTitle>
                  {preset.isBuiltIn && (
                    <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">
                      Built-in
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {preset.description}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${topologyBadgeClasses[preset.topology] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {topologyLabels[preset.topology] ?? preset.topology}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {preset.nodeCount} nodes
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {preset.isBuiltIn && onFork && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFork(preset.name, preset.description);
                        }}
                      >
                        <GitBranch className="h-3 w-3 mr-1" />
                        Fork
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onPreview('chain', preset)}
                    >
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApply(preset.id)}
                      disabled={applyLoading === preset.id}
                    >
                      {applyLoading === preset.id && (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      )}
                      Use This
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
