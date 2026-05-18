'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Package, Shield, Zap, GitBranch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ConfigTemplate } from '@/types/config';

interface ProtocolTemplatesGridProps {
  onPreview: (type: string, data: unknown) => void;
  onFork?: (name: string, description: string) => void;
}

export function ProtocolTemplatesGrid({
  onPreview,
  onFork,
}: ProtocolTemplatesGridProps) {
  const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const response = await fetch('/api/configs/templates');
      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Failed to fetch templates');
        return;
      }

      setTemplates(result.data);
      setError(null);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/configs/templates/seed', { method: 'POST' }).catch(() => {});
    fetchTemplates();
  }, [fetchTemplates]);

  function ProtocolIcon({ serviceType }: { serviceType: string | null }) {
    if (serviceType === 'AWG') {
      return <Shield className="h-4 w-4 text-blue-500" />;
    }
    return <Zap className="h-4 w-4 text-green-500" />;
  }

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

      {templates.length === 0 && !error && (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Package className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            No templates available
          </h3>
          <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
            Built-in protocol templates will appear here. You can also save your
            current configuration as a custom template.
          </p>
          <div className="mt-6">
            <Button variant="outline" onClick={fetchTemplates}>
              Refresh Templates
            </Button>
          </div>
        </div>
      )}

      {templates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <Card
              key={template.id}
              className="hover:border-accent/50 transition-colors"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ProtocolIcon serviceType={template.serviceType} />
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  {template.isBuiltIn && (
                    <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">
                      Built-in
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {template.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">
                    {template.serviceType === 'AWG' ? 'AWG' : '3x-ui'}
                  </span>
                  <div className="flex gap-2">
                    {template.isBuiltIn && onFork && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFork(template.name, template.description);
                        }}
                      >
                        <GitBranch className="h-3 w-3 mr-1" />
                        Fork
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onPreview('protocol', template)}
                    >
                      Preview
                    </Button>
                    <Button size="sm">Use This</Button>
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
