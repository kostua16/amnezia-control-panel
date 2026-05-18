'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Globe,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GeoRuleDrawer } from '@/components/routing/geo-rule-drawer';
import { GeoIPStatusBadge } from '@/components/routing/geoip-status-badge';
import { EmptyStateStarter } from '@/components/routing/empty-state-starter';
import { GEO_STARTER_RULES } from '@/lib/geo-starter-rules';
import type {
  GeoRoutingRule,
  GeoRuleCreate,
  GeoMatchType,
} from '@/types/geo-routing';

// ─── Helpers ─────────────────────────────────────────────

function countryCodeToFlag(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

function matchTypeLabel(
  matchType: GeoMatchType,
  target: GeoRoutingRule['target'],
): string {
  switch (matchType) {
    case 'country':
      return `${countryCodeToFlag(target.countryCode ?? '')} ${target.countryCode ?? ''}`;
    case 'region':
      return target.region ?? 'Unknown region';
    case 'special':
      return target.special === 'domestic' ? 'Domestic' : 'Foreign';
  }
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    ALLOW: 'Allow',
    BLOCK: 'Block',
    ROUTE: 'Route',
  };
  return labels[action] ?? action;
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

// ─── Component ───────────────────────────────────────────

export function GeoRulesList() {
  const [rules, setRules] = useState<GeoRoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<GeoRoutingRule | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [starterLoading, setStarterLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // ─── Data fetching ──────────────────────────────────

  const fetchRules = useCallback(async () => {
    try {
      const response = await fetch('/api/routing/geo');
      const result = await response.json();

      if (!response.ok) {
        setApiError(result.error || 'Failed to fetch geo rules');
        return;
      }

      setRules(result.data);
      setApiError(null);
    } catch {
      setApiError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // ─── Handlers ───────────────────────────────────────

  const handleSubmit = useCallback(
    async (data: GeoRuleCreate) => {
      setSubmitting(true);
      setApiError(null);

      const isEdit = editingRule !== null;
      const url = isEdit
        ? `/api/routing/geo/${editingRule.id}`
        : '/api/routing/geo';
      const method = isEdit ? 'PUT' : 'POST';

      try {
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (!response.ok) {
          setApiError(
            result.error || `Failed to ${isEdit ? 'update' : 'create'} rule`,
          );
          return;
        }

        setDrawerOpen(false);
        setEditingRule(null);
        setLoading(true);
        fetchRules();
      } catch {
        setApiError('Network error. Please check your connection.');
      } finally {
        setSubmitting(false);
      }
    },
    [editingRule, fetchRules],
  );

  const handleDelete = useCallback(async () => {
    if (deleteConfirmId === null) return;

    setDeleteLoading(true);
    setApiError(null);

    try {
      const response = await fetch(`/api/routing/geo/${deleteConfirmId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        setApiError(result.error || 'Failed to delete rule');
        return;
      }

      setDeleteConfirmId(null);
      setLoading(true);
      fetchRules();
    } catch {
      setApiError('Network error. Please check your connection.');
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteConfirmId, fetchRules]);

  const handleToggleActive = useCallback(
    async (rule: GeoRoutingRule) => {
      setApiError(null);

      try {
        const response = await fetch(`/api/routing/geo/${rule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !rule.isActive }),
        });

        if (!response.ok) {
          const result = await response.json();
          setApiError(result.error || 'Failed to toggle rule');
          return;
        }

        setLoading(true);
        fetchRules();
      } catch {
        setApiError('Network error. Please check your connection.');
      }
    },
    [fetchRules],
  );

  const handleMove = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= rules.length) return;

      const reorderPairs = rules.map((rule, i) => {
        if (i === index)
          return { id: rule.id, priority: rules[targetIndex].priority };
        if (i === targetIndex)
          return { id: rule.id, priority: rules[index].priority };
        return { id: rule.id, priority: rule.priority };
      });

      setApiError(null);

      try {
        const response = await fetch('/api/routing/geo/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: reorderPairs }),
        });

        if (!response.ok) {
          const result = await response.json();
          setApiError(result.error || 'Failed to reorder rules');
          return;
        }

        setLoading(true);
        fetchRules();
      } catch {
        setApiError('Network error. Please check your connection.');
      }
    },
    [rules, fetchRules],
  );

  const handleLoadStarterRules = useCallback(async () => {
    setStarterLoading(true);
    setApiError(null);

    try {
      for (const rule of GEO_STARTER_RULES) {
        const { matchType: _m, ...payload } = rule;
        const response = await fetch('/api/routing/geo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
          setApiError(result.error || 'Failed to add starter rules');
          setLoading(true);
          await fetchRules();
          return;
        }
      }
      setLoading(true);
      await fetchRules();
    } catch {
      setApiError('Network error. Please check your connection.');
      setLoading(true);
      await fetchRules();
    } finally {
      setStarterLoading(false);
    }
  }, [fetchRules]);

  const openCreateDrawer = useCallback(() => {
    setEditingRule(null);
    setDrawerOpen(true);
  }, []);

  const openEditDrawer = useCallback((rule: GeoRoutingRule) => {
    setEditingRule(rule);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setEditingRule(null);
  }, []);

  // ─── Render ─────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Geo Routing Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading rules...
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Geo Routing Rules</CardTitle>
        <div className="flex items-center gap-2">
          <GeoIPStatusBadge />
          <Button size="sm" onClick={openCreateDrawer}>
            <Plus className="mr-2 h-4 w-4" />
            Add Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error banner */}
        {apiError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {apiError}
          </div>
        )}

        {/* Empty state */}
        {rules.length === 0 && (
          <EmptyStateStarter
            onLoadStarter={handleLoadStarterRules}
            onCreateCustom={openCreateDrawer}
            loading={starterLoading}
          />
        )}

        {/* Rules table */}
        {rules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-3 font-medium text-muted-foreground w-16">
                    Order
                  </th>
                  <th className="px-3 py-3 font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="px-3 py-3 font-medium text-muted-foreground">
                    Match
                  </th>
                  <th className="px-3 py-3 font-medium text-muted-foreground">
                    Action
                  </th>
                  <th className="hidden px-3 py-3 font-medium text-muted-foreground sm:table-cell">
                    Chain
                  </th>
                  <th className="px-3 py-3 font-medium text-muted-foreground">
                    Active
                  </th>
                  <th className="px-3 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr
                    key={rule.id}
                    className={clsx(
                      'border-b border-border last:border-0',
                      !rule.isActive && 'opacity-50',
                    )}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                          onClick={() => handleMove(index, 'up')}
                          disabled={index === 0}
                          aria-label="Move rule up"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                          onClick={() => handleMove(index, 'down')}
                          disabled={index === rules.length - 1}
                          aria-label="Move rule down"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm font-medium">{rule.name}</span>
                    </td>
                    <td className="px-3 py-3">
                      {rule.matchType === 'country' &&
                      rule.target.countryCode ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span>
                            {countryCodeToFlag(rule.target.countryCode)}
                          </span>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {rule.target.countryCode}
                          </code>
                        </span>
                      ) : rule.matchType === 'region' ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{rule.target.region ?? 'Unknown'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>
                            {rule.target.special === 'domestic'
                              ? 'Domestic'
                              : 'Foreign'}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={clsx(
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                          actionStyle(rule.action),
                        )}
                      >
                        {actionLabel(rule.action)}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell">
                      <span className="text-sm text-muted-foreground">
                        {rule.chainId ? `#${rule.chainId}` : '--'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={rule.isActive}
                        onChange={() => handleToggleActive(rule)}
                        className="h-4 w-4 rounded border-border accent-accent"
                        aria-label="Toggle active"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditDrawer(rule)}
                          aria-label="Edit rule"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setDeleteConfirmId(rule.id)}
                          aria-label="Delete rule"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Delete confirmation */}
        {deleteConfirmId !== null && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-foreground">
              Are you sure you want to delete this routing rule?
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirmId(null)}
                disabled={deleteLoading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteLoading}
              >
                {deleteLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Delete Rule
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Rule drawer */}
      <GeoRuleDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        rule={editingRule}
        onSubmit={handleSubmit}
        loading={submitting}
      />
    </Card>
  );
}
