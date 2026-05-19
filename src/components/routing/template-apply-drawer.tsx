'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { X, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import type { RoutingRuleTemplate } from '@/types/routing-rule-template';

interface TemplateApplyDrawerProps {
  open: boolean;
  onClose: () => void;
  template: RoutingRuleTemplate | null;
  onApplied?: () => void;
}

interface TemplateRuleDef {
  name: string;
  matchType: 'country' | 'region' | 'special';
  countryCode?: string;
  region?: string;
  special?: 'domestic' | 'foreign';
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number | null;
  priority: number;
}

function actionStyle(action: string): string {
  switch (action) {
    case 'ALLOW':
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'BLOCK':
      return 'bg-red-500/10 text-red-700 dark:text-red-400';
    case 'ROUTE':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function matchTypeLabel(rule: TemplateRuleDef): string {
  switch (rule.matchType) {
    case 'country':
      return `Country: ${rule.countryCode ?? 'Unknown'}`;
    case 'region':
      return `Region: ${rule.region ?? 'Unknown'}`;
    case 'special':
      return rule.special === 'domestic'
        ? 'Special: Domestic'
        : 'Special: Foreign';
  }
}

export function TemplateApplyDrawer({
  open,
  onClose,
  template,
  onApplied,
}: TemplateApplyDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset state when template changes
  useEffect(() => {
    startTransition(() => { setLoading(false); setError(null); });
  }, [template]);

  const handleApply = useCallback(async () => {
    if (!template) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/routing/templates/${template.id}`, {
        method: 'POST',
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Failed to apply template');
        return;
      }

      onApplied?.();
      onClose();
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [template, onApplied, onClose]);

  if (!open || !template) return null;

  const rules = (template.rules ?? []) as TemplateRuleDef[];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-96 max-w-full border-l border-border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold">{template.name}</h2>
            {template.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {template.description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Rule list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <h3 className="text-sm font-medium text-muted-foreground">
            {rules.length} rule{rules.length !== 1 ? 's' : ''} in this template
          </h3>

          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This template has no rules.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">
                      Match
                    </th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">
                      Action
                    </th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                      Priority
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule, idx) => (
                    <tr
                      key={`${rule.name}-${idx}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-2 py-2">
                        <span className="text-sm font-medium">{rule.name}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-xs text-muted-foreground">
                          {matchTypeLabel(rule)}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={clsx(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                            actionStyle(rule.action),
                          )}
                        >
                          {rule.action}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <span className="text-xs text-muted-foreground">
                          {rule.priority}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4">
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={loading || rules.length === 0}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply Template
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
