'use client';

import { useState, useCallback } from 'react';
import { Package, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getPresets } from '@/lib/config-presets';
import type { ConfigPreset } from '@/types/config';

const SERVER_TAGS = ['hetzner', 'digitalocean', 'vultr', 'contabo'];

interface ServerPresetsGridProps {
  onPreview: (type: string, data: unknown) => void;
}

export function ServerPresetsGrid({ onPreview }: ServerPresetsGridProps) {
  const [_refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const presets = getPresets().filter((p) =>
    p.tags.some((tag) => SERVER_TAGS.includes(tag)),
  );

  const handleRefresh = useCallback(() => {
    setError(null);
    setRefreshKey((k) => k + 1);
  }, []);

  function extractProvider(label: string): string {
    const provider = label.split(' ')[0];
    return provider || label;
  }

  function getMtu(preset: ConfigPreset): string | null {
    const mtu = preset.settings.mtu ?? preset.settings.recommendedMtu;
    return typeof mtu === 'number' ? `MTU ${mtu}` : null;
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
            Server presets for popular VPS providers will appear here.
          </p>
          <div className="mt-6">
            <Button variant="outline" onClick={handleRefresh}>
              Refresh Templates
            </Button>
          </div>
        </div>
      )}

      {presets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map((preset) => (
            <Card
              key={preset.name}
              className="hover:border-accent/50 transition-colors"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{preset.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {preset.description}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {extractProvider(preset.label)}
                    </span>
                    {getMtu(preset) && (
                      <span className="text-xs text-muted-foreground">
                        {getMtu(preset)}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPreview('server', preset)}
                  >
                    Preview
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
