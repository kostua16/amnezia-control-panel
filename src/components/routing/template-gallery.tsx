'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TemplateApplyDrawer } from '@/components/routing/template-apply-drawer';
import type { RoutingRuleTemplate } from '@/types/routing-rule-template';

interface TemplateGalleryProps {
  onApplied?: () => void;
}

export function TemplateGallery({ onApplied }: TemplateGalleryProps) {
  const [templates, setTemplates] = useState<RoutingRuleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyLoading, setApplyLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] =
    useState<RoutingRuleTemplate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const response = await fetch('/api/routing/templates');
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
    // Seed built-in templates on mount (fire-and-forget)
    fetch('/api/routing/templates/seed', { method: 'POST' }).catch(() => {});
    fetchTemplates();
  }, [fetchTemplates]);

  const handleApply = useCallback(
    async (templateId: number) => {
      setApplyLoading(templateId);
      setError(null);

      try {
        const response = await fetch(`/api/routing/templates/${templateId}`, {
          method: 'POST',
        });

        const result = await response.json();

        if (!response.ok) {
          setError(result.error || 'Failed to apply template');
          return;
        }

        onApplied?.();
      } catch {
        setError('Network error. Please check your connection.');
      } finally {
        setApplyLoading(null);
      }
    },
    [onApplied],
  );

  const handlePreview = useCallback((template: RoutingRuleTemplate) => {
    setPreviewTemplate(template);
    setDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
    setPreviewTemplate(null);
  }, []);

  const handleDrawerApplied = useCallback(() => {
    setDrawerOpen(false);
    setPreviewTemplate(null);
    onApplied?.();
  }, [onApplied]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Routing Rule Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading templates...
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Routing Rule Templates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error banner */}
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Empty state */}
        {templates.length === 0 && !error && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              No templates available
            </h3>
            <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
              Built-in templates will appear here. Try refreshing the page.
            </p>
            <div className="mt-6">
              <Button variant="outline" onClick={fetchTemplates}>
                Refresh Templates
              </Button>
            </div>
          </div>
        )}

        {/* Template cards grid */}
        {templates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <Card
                key={template.id}
                className="hover:border-accent/50 transition-colors"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
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
                    <span className="text-xs text-muted-foreground">
                      {template.ruleCount} rules
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePreview(template)}
                      >
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleApply(template.id)}
                        disabled={applyLoading === template.id}
                      >
                        {applyLoading === template.id && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        Apply
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>

      {/* Preview & Apply drawer */}
      <TemplateApplyDrawer
        open={drawerOpen}
        onClose={handleCloseDrawer}
        template={previewTemplate}
        onApplied={handleDrawerApplied}
      />
    </Card>
  );
}
