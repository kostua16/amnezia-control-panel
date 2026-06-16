'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PROTOCOL_OPTIONS,
  ACTION_OPTIONS,
  protocolLabel,
  actionLabel,
  actionStyle,
} from '@/lib/routing-constants';
import {
  useRoutingAutoSave,
  AutoSaveIndicator,
} from '@/components/chains/use-routing-auto-save';
import type {
  RoutingRule,
  RoutingRuleCreate,
  RuleProtocol,
  RuleAction,
  ReorderPair,
} from '@/types/routing';

interface RoutingFormErrors {
  destination?: string;
  priority?: string;
}

interface IpDomainRoutingFormProps {
  /** Bumped by the parent (e.g. after a template is applied) to trigger a refetch. */
  refreshSignal: number;
}

export function IpDomainRoutingForm({
  refreshSignal,
}: IpDomainRoutingFormProps) {
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);
  const [routingLoading, setRoutingLoading] = useState(true);
  const [routingShowForm, setRoutingShowForm] = useState(false);
  const [routingEditingRule, setRoutingEditingRule] =
    useState<RoutingRule | null>(null);
  const [routingDeleteConfirmId, setRoutingDeleteConfirmId] = useState<
    number | null
  >(null);
  const [routingDeleteLoading, setRoutingDeleteLoading] = useState(false);
  const [routingSubmitting, setRoutingSubmitting] = useState(false);
  const [routingApiError, setRoutingApiError] = useState<string | null>(null);

  const [routingFormProtocol, setRoutingFormProtocol] =
    useState<RuleProtocol>('ANY');
  const [routingFormDestination, setRoutingFormDestination] = useState('');
  const [routingFormAction, setRoutingFormAction] =
    useState<RuleAction>('ALLOW');
  const [routingFormPriority, setRoutingFormPriority] = useState('0');
  const [routingFormIsActive, setRoutingFormIsActive] = useState(true);
  const [routingFormErrors, setRoutingFormErrors] = useState<RoutingFormErrors>(
    {},
  );

  const fetchRoutingRules = useCallback(async () => {
    try {
      const response = await fetch('/api/routing/rules');
      const result = await response.json();
      if (!response.ok) {
        setRoutingApiError(result.error || 'Failed to fetch routing rules');
        return;
      }
      setRoutingRules(result.data);
      setRoutingApiError(null);
    } catch {
      setRoutingApiError('Network error. Please check your connection.');
    } finally {
      setRoutingLoading(false);
    }
  }, []);

  useEffect(() => {
    setRoutingLoading(true);
    startTransition(() => {
      fetchRoutingRules();
    });
  }, [fetchRoutingRules, refreshSignal]);

  const {
    status: routingAutoSaveStatus,
    save: routingAutoSave,
    cancel: cancelRoutingAutoSave,
  } = useRoutingAutoSave<RoutingRuleCreate>({
    resolveRequest: (id) =>
      id
        ? { url: `/api/routing/rules/${id}`, method: 'PUT' }
        : { url: '/api/routing/rules', method: 'POST' },
    onSuccess: fetchRoutingRules,
    onError: setRoutingApiError,
  });

  function resetRoutingForm() {
    setRoutingFormProtocol('ANY');
    setRoutingFormDestination('');
    setRoutingFormAction('ALLOW');
    setRoutingFormPriority('0');
    setRoutingFormIsActive(true);
    setRoutingFormErrors({});
  }

  const openRoutingCreateForm = useCallback(() => {
    setRoutingEditingRule(null);
    resetRoutingForm();
    setRoutingShowForm(true);
  }, []);

  const openRoutingEditForm = useCallback((rule: RoutingRule) => {
    setRoutingEditingRule(rule);
    setRoutingFormProtocol(rule.protocol);
    setRoutingFormDestination(rule.destination);
    setRoutingFormAction(rule.action);
    setRoutingFormPriority(String(rule.priority));
    setRoutingFormIsActive(rule.isActive);
    setRoutingFormErrors({});
    setRoutingShowForm(true);
  }, []);

  const closeRoutingForm = useCallback(() => {
    setRoutingShowForm(false);
    setRoutingEditingRule(null);
    cancelRoutingAutoSave();
  }, [cancelRoutingAutoSave]);

  const validateRoutingForm = useCallback((): boolean => {
    const newErrors: RoutingFormErrors = {};
    if (!routingFormDestination.trim())
      newErrors.destination = 'Destination is required';
    if (
      isNaN(parseInt(routingFormPriority, 10)) ||
      parseInt(routingFormPriority, 10) < 0
    ) {
      newErrors.priority = 'Priority must be 0 or greater';
    }
    setRoutingFormErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [routingFormDestination, routingFormPriority]);

  const handleRoutingFieldChange = useCallback(() => {
    if (!routingEditingRule) return;
    if (!validateRoutingForm()) return;

    routingAutoSave(
      {
        protocol: routingFormProtocol,
        destination: routingFormDestination.trim(),
        action: routingFormAction,
        priority: parseInt(routingFormPriority, 10) || 0,
        isActive: routingFormIsActive,
      },
      routingEditingRule.id,
    );
  }, [
    routingEditingRule,
    routingFormProtocol,
    routingFormDestination,
    routingFormAction,
    routingFormPriority,
    routingFormIsActive,
    validateRoutingForm,
    routingAutoSave,
  ]);

  const handleRoutingCreate = useCallback(() => {
    if (!validateRoutingForm()) return;

    setRoutingSubmitting(true);
    setRoutingApiError(null);

    fetch('/api/routing/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: routingFormProtocol,
        destination: routingFormDestination.trim(),
        action: routingFormAction,
        priority: parseInt(routingFormPriority, 10) || 0,
        isActive: routingFormIsActive,
      }),
    })
      .then(() => {
        setRoutingShowForm(false);
        setRoutingEditingRule(null);
        setRoutingLoading(true);
        fetchRoutingRules();
      })
      .catch(() => {
        setRoutingApiError('Network error. Please check your connection.');
      })
      .finally(() => setRoutingSubmitting(false));
  }, [
    routingFormProtocol,
    routingFormDestination,
    routingFormAction,
    routingFormPriority,
    routingFormIsActive,
    validateRoutingForm,
    fetchRoutingRules,
  ]);

  const handleRoutingDelete = useCallback(async () => {
    if (routingDeleteConfirmId === null) return;
    setRoutingDeleteLoading(true);
    setRoutingApiError(null);
    try {
      const response = await fetch(
        `/api/routing/rules/${routingDeleteConfirmId}`,
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) {
        const result = await response.json();
        setRoutingApiError(result.error || 'Failed to delete rule');
        return;
      }
      setRoutingDeleteConfirmId(null);
      setRoutingLoading(true);
      fetchRoutingRules();
    } catch {
      setRoutingApiError('Network error.');
    } finally {
      setRoutingDeleteLoading(false);
    }
  }, [routingDeleteConfirmId, fetchRoutingRules]);

  const handleRoutingToggle = useCallback(
    async (rule: RoutingRule) => {
      setRoutingApiError(null);
      try {
        const response = await fetch(`/api/routing/rules/${rule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !rule.isActive }),
        });
        if (!response.ok) {
          const result = await response.json();
          setRoutingApiError(result.error || 'Failed to toggle rule');
          return;
        }
        setRoutingLoading(true);
        fetchRoutingRules();
      } catch {
        setRoutingApiError('Network error.');
      }
    },
    [fetchRoutingRules],
  );

  const handleRoutingMove = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= routingRules.length) return;

      const reorderPairs: ReorderPair[] = routingRules.map((rule, i) => {
        if (i === index)
          return { id: rule.id, priority: routingRules[targetIndex].priority };
        if (i === targetIndex)
          return { id: rule.id, priority: routingRules[index].priority };
        return { id: rule.id, priority: rule.priority };
      });

      setRoutingApiError(null);
      try {
        const response = await fetch('/api/routing/rules/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: reorderPairs }),
        });
        if (!response.ok) {
          const result = await response.json();
          setRoutingApiError(result.error || 'Failed to reorder rules');
          return;
        }
        setRoutingLoading(true);
        fetchRoutingRules();
      } catch {
        setRoutingApiError('Network error.');
      }
    },
    [routingRules, fetchRoutingRules],
  );

  return (
    <div
      className="p-4 space-y-3"
      role="tabpanel"
      aria-label="IP and domain routing rules"
    >
      {routingApiError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {routingApiError}
        </div>
      )}

      {routingLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading rules...
          </span>
        </div>
      ) : routingRules.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No routing rules found. Create one to get started.
          </p>
        </div>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 font-medium text-muted-foreground w-14">
                  Order
                </th>
                <th className="px-2 py-2 font-medium text-muted-foreground">
                  Protocol
                </th>
                <th className="px-2 py-2 font-medium text-muted-foreground">
                  Destination
                </th>
                <th className="px-2 py-2 font-medium text-muted-foreground">
                  Action
                </th>
                <th className="px-2 py-2 font-medium text-muted-foreground">
                  Active
                </th>
                <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {routingRules.map((rule, index) => (
                <tr
                  key={rule.id}
                  className={clsx(
                    'border-b border-border last:border-0',
                    !rule.isActive && 'opacity-50',
                  )}
                >
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-0.5">
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        onClick={() => handleRoutingMove(index, 'up')}
                        disabled={index === 0}
                        aria-label="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        onClick={() => handleRoutingMove(index, 'down')}
                        disabled={index === routingRules.length - 1}
                        aria-label="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-xs">
                      {protocolLabel(rule.protocol)}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                      {rule.destination}
                    </code>
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={clsx(
                        'inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium',
                        actionStyle(rule.action),
                      )}
                    >
                      {actionLabel(rule.action)}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={rule.isActive}
                      onChange={() => handleRoutingToggle(rule)}
                      className="h-3.5 w-3.5 rounded border-border accent-accent"
                      aria-label="Toggle active"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => openRoutingEditForm(rule)}
                        aria-label="Edit rule"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1 text-destructive hover:bg-destructive/10"
                        onClick={() => setRoutingDeleteConfirmId(rule.id)}
                        aria-label="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Routing delete confirmation */}
          {routingDeleteConfirmId !== null && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2">
              <p className="text-sm">
                Are you sure you want to delete this rule?
              </p>
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRoutingDeleteConfirmId(null)}
                  disabled={routingDeleteLoading}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRoutingDelete}
                  disabled={routingDeleteLoading}
                >
                  {routingDeleteLoading && (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Inline routing form (accordion) */}
      {routingShowForm && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {routingEditingRule ? 'Edit Rule' : 'New Routing Rule'}
            </span>
            {routingEditingRule && (
              <AutoSaveIndicator status={routingAutoSaveStatus} />
            )}
          </div>

          {/* Protocol */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              Protocol
            </label>
            <select
              value={routingFormProtocol}
              onChange={(e) => {
                setRoutingFormProtocol(e.target.value as RuleProtocol);
                if (routingEditingRule) handleRoutingFieldChange();
              }}
              disabled={routingSubmitting}
              className={clsx(
                'flex h-8 w-full rounded-md border border-border bg-background px-2 py-1',
                'text-sm text-foreground',
              )}
            >
              {PROTOCOL_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Destination */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              Destination
            </label>
            <Input
              type="text"
              placeholder="e.g., 1.2.3.0/24, example.com"
              value={routingFormDestination}
              onChange={(e) => {
                setRoutingFormDestination(e.target.value);
                if (routingEditingRule) handleRoutingFieldChange();
              }}
              disabled={routingSubmitting}
              className={clsx(
                'h-8 text-sm',
                routingFormErrors.destination && 'border-destructive',
              )}
            />
            {routingFormErrors.destination && (
              <p className="text-xs text-destructive">
                {routingFormErrors.destination}
              </p>
            )}
          </div>

          {/* Action */}
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">
              Action
            </span>
            <div className="flex gap-3">
              {ACTION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <input
                    type="radio"
                    name="drawer-routing-action"
                    value={opt.value}
                    checked={routingFormAction === opt.value}
                    onChange={() => {
                      setRoutingFormAction(opt.value);
                      if (routingEditingRule) handleRoutingFieldChange();
                    }}
                    disabled={routingSubmitting}
                    className="accent-accent"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              Priority
            </label>
            <Input
              type="number"
              min={0}
              value={routingFormPriority}
              onChange={(e) => {
                setRoutingFormPriority(e.target.value);
                if (routingEditingRule) handleRoutingFieldChange();
              }}
              disabled={routingSubmitting}
              className={clsx(
                'h-8 text-sm',
                routingFormErrors.priority && 'border-destructive',
              )}
            />
            {routingFormErrors.priority && (
              <p className="text-xs text-destructive">
                {routingFormErrors.priority}
              </p>
            )}
          </div>

          {/* Active */}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={routingFormIsActive}
              onChange={(e) => {
                setRoutingFormIsActive(e.target.checked);
                if (routingEditingRule) handleRoutingFieldChange();
              }}
              disabled={routingSubmitting}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Rule is active
          </label>

          {/* Form actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={closeRoutingForm}
              disabled={routingSubmitting}
            >
              Cancel
            </Button>
            {!routingEditingRule && (
              <Button
                size="sm"
                onClick={handleRoutingCreate}
                disabled={routingSubmitting}
              >
                {routingSubmitting && (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                Create Rule
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Add Rule button */}
      {!routingShowForm && (
        <Button
          variant="outline"
          size="sm"
          onClick={openRoutingCreateForm}
          className="w-full"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Rule
        </Button>
      )}
    </div>
  );
}
