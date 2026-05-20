'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Filter,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CreateRoutingRuleForm } from '@/components/routing/create-routing-rule-form';
import type {
  RoutingRule,
  RuleProtocol,
  RuleAction,
  ReorderPair,
} from '@/types/routing';
import type { UserListItem } from '@/types/user';

// ─── Helpers ─────────────────────────────────────────────

function protocolLabel(protocol: string): string {
  const labels: Record<string, string> = {
    ANY: 'Any',
    WIREGUARD: 'WireGuard',
    VLESS: 'VLESS',
    VMESS: 'VMess',
    TROJAN: 'Trojan',
    SHADOWSOCKS: 'Shadowsocks',
  };
  return labels[protocol] ?? protocol;
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

// ─── Types ───────────────────────────────────────────────

interface RuleWithUser extends RoutingRule {
  user: { id: number; username: string; displayName: string | null } | null;
}

// ─── Component ───────────────────────────────────────────

export function RoutingRulesList() {
  const [rules, setRules] = useState<RuleWithUser[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleWithUser | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Filter state
  const [filterUserId, setFilterUserId] = useState('');
  const [filterProtocol, setFilterProtocol] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // ─── Data fetching ──────────────────────────────────

  const fetchRules = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterUserId) params.set('userId', filterUserId);
      if (filterActive) params.set('isActive', filterActive);
      // Protocol filtering done client-side since API uses enum but we store string

      const response = await fetch(`/api/routing/rules?${params.toString()}`);
      const result = await response.json();

      if (!response.ok) {
        setApiError(result.error || 'Failed to fetch rules');
        return;
      }

      let data: RuleWithUser[] = result.data;
      if (filterProtocol) {
        data = data.filter((r: RuleWithUser) => r.protocol === filterProtocol);
      }

      setRules(data);
      setApiError(null);
    } catch {
      setApiError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [filterUserId, filterActive, filterProtocol]);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/users?limit=100&page=1');
      const result = await response.json();
      if (response.ok && result.data) {
        setUsers(result.data);
      }
    } catch {
      // Non-critical: users dropdown in create form can be empty
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      setLoading(true);
      fetchRules();
    });
  }, [fetchRules]);

  useEffect(() => {
    startTransition(() => {
      fetchUsers();
    });
  }, [fetchUsers]);

  // ─── Handlers ───────────────────────────────────────

  const handleCreate = useCallback(
    async (data: {
      protocol: RuleProtocol;
      destination: string;
      action: RuleAction;
      priority: number;
      isActive: boolean;
      userId: number | null;
    }) => {
      setApiError(null);

      try {
        const response = await fetch('/api/routing/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (!response.ok) {
          setApiError(result.error || 'Failed to create rule');
          return;
        }

        setCreateModalOpen(false);
        setLoading(true);
        fetchRules();
      } catch {
        setApiError('Network error. Please check your connection.');
      }
    },
    [fetchRules],
  );

  const handleEdit = useCallback(
    async (data: {
      protocol: RuleProtocol;
      destination: string;
      action: RuleAction;
      priority: number;
      isActive: boolean;
      userId: number | null;
    }) => {
      if (!editingRule) return;

      setApiError(null);

      try {
        const response = await fetch(`/api/routing/rules/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (!response.ok) {
          setApiError(result.error || 'Failed to update rule');
          return;
        }

        setEditModalOpen(false);
        setEditingRule(null);
        setLoading(true);
        fetchRules();
      } catch {
        setApiError('Network error. Please check your connection.');
      }
    },
    [editingRule, fetchRules],
  );

  const handleDelete = useCallback(async () => {
    if (deleteConfirmId === null) return;

    setDeleteLoading(true);
    setApiError(null);

    try {
      const response = await fetch(`/api/routing/rules/${deleteConfirmId}`, {
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
    async (rule: RuleWithUser) => {
      setApiError(null);

      try {
        const response = await fetch(`/api/routing/rules/${rule.id}`, {
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

      const reorderPairs: ReorderPair[] = rules.map((rule, i) => {
        if (i === index) {
          return { id: rule.id, priority: rules[targetIndex].priority };
        }
        if (i === targetIndex) {
          return { id: rule.id, priority: rules[index].priority };
        }
        return { id: rule.id, priority: rule.priority };
      });

      setApiError(null);

      try {
        const response = await fetch('/api/routing/rules/reorder', {
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

  // ─── Render ─────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Routing Rules</CardTitle>
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
        <CardTitle>Routing Rules</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
          <Button size="sm" onClick={() => setCreateModalOpen(true)}>
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

        {/* Filters */}
        {showFilters && (
          <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                User
              </label>
              <select
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className={clsx(
                  'flex h-9 w-full rounded-md border border-border bg-background px-3 py-1',
                  'text-sm text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <option value="">All Users</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName ?? user.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Protocol
              </label>
              <select
                value={filterProtocol}
                onChange={(e) => setFilterProtocol(e.target.value)}
                className={clsx(
                  'flex h-9 w-full rounded-md border border-border bg-background px-3 py-1',
                  'text-sm text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <option value="">All Protocols</option>
                <option value="ANY">Any</option>
                <option value="WIREGUARD">WireGuard</option>
                <option value="VLESS">VLESS</option>
                <option value="VMESS">VMess</option>
                <option value="TROJAN">Trojan</option>
                <option value="SHADOWSOCKS">Shadowsocks</option>
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Status
              </label>
              <select
                value={filterActive}
                onChange={(e) => setFilterActive(e.target.value)}
                className={clsx(
                  'flex h-9 w-full rounded-md border border-border bg-background px-3 py-1',
                  'text-sm text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterUserId('');
                setFilterProtocol('');
                setFilterActive('');
              }}
            >
              Clear
            </Button>
          </div>
        )}

        {/* Empty state */}
        {rules.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No routing rules found. Create one to get started.
            </p>
          </div>
        )}

        {/* Rules table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-3 font-medium text-muted-foreground w-16">
                  Order
                </th>
                <th className="px-3 py-3 font-medium text-muted-foreground">
                  Protocol
                </th>
                <th className="px-3 py-3 font-medium text-muted-foreground">
                  Destination
                </th>
                <th className="px-3 py-3 font-medium text-muted-foreground">
                  Action
                </th>
                <th className="px-3 py-3 font-medium text-muted-foreground">
                  Active
                </th>
                <th className="hidden px-3 py-3 font-medium text-muted-foreground sm:table-cell">
                  User
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
                        aria-label="Move up"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === rules.length - 1}
                        aria-label="Move down"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-sm">
                      {protocolLabel(rule.protocol)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                      {rule.destination}
                    </code>
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
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={rule.isActive}
                      onChange={() => handleToggleActive(rule)}
                      className="h-4 w-4 rounded border-border accent-accent"
                      aria-label="Toggle active"
                    />
                  </td>
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {rule.user
                        ? (rule.user.displayName ?? rule.user.username)
                        : 'Global'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingRule(rule);
                          setEditModalOpen(true);
                        }}
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

      {/* Create rule modal */}
      <Dialog
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Routing Rule"
      >
        <CreateRoutingRuleForm
          users={users}
          onSubmit={handleCreate}
          onCancel={() => setCreateModalOpen(false)}
        />
      </Dialog>

      {/* Edit rule modal */}
      <Dialog
        open={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setEditingRule(null);
        }}
        title="Edit Routing Rule"
      >
        {editingRule && (
          <CreateRoutingRuleForm
            key={editingRule.id}
            users={users}
            initialData={{
              protocol: editingRule.protocol as RuleProtocol,
              destination: editingRule.destination,
              action: editingRule.action as RuleAction,
              priority: editingRule.priority,
              isActive: editingRule.isActive,
              userId: editingRule.userId,
            }}
            onSubmit={handleEdit}
            onCancel={() => {
              setEditModalOpen(false);
              setEditingRule(null);
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}
