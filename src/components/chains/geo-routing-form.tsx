'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  startTransition,
} from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { countryCodeToFlag } from '@/lib/format-country';
import {
  MATCH_TYPE_OPTIONS,
  REGION_OPTIONS,
  SPECIAL_OPTIONS,
  ACTION_OPTIONS,
  actionLabel,
  actionStyle,
} from '@/lib/routing-constants';
import {
  useRoutingAutoSave,
  AutoSaveIndicator,
} from '@/components/chains/use-routing-auto-save';
import type {
  GeoRoutingRule,
  GeoRuleCreate,
  GeoMatchType,
} from '@/types/geo-routing';

interface GeoFormErrors {
  name?: string;
  countryCode?: string;
  priority?: string;
}

interface GeoRoutingFormProps {
  chainId?: number | null;
  /** Bumped by the parent (e.g. after a template is applied) to trigger a refetch. */
  refreshSignal: number;
}

export function GeoRoutingForm({
  chainId,
  refreshSignal,
}: GeoRoutingFormProps) {
  const [geoRules, setGeoRules] = useState<GeoRoutingRule[]>([]);
  const [geoLoading, setGeoLoading] = useState(true);
  const [geoShowForm, setGeoShowForm] = useState(false);
  const [geoEditingRule, setGeoEditingRule] = useState<GeoRoutingRule | null>(
    null,
  );
  const [geoDeleteConfirmId, setGeoDeleteConfirmId] = useState<number | null>(
    null,
  );
  const [geoDeleteLoading, setGeoDeleteLoading] = useState(false);
  const [geoSubmitting, setGeoSubmitting] = useState(false);
  const [geoApiError, setGeoApiError] = useState<string | null>(null);

  const [geoFormName, setGeoFormName] = useState('');
  const [geoFormMatchType, setGeoFormMatchType] =
    useState<GeoMatchType>('country');
  const [geoFormCountryCode, setGeoFormCountryCode] = useState('');
  const [geoFormRegion, setGeoFormRegion] = useState('');
  const [geoFormSpecial, setGeoFormSpecial] = useState<'domestic' | 'foreign'>(
    'domestic',
  );
  const [geoFormAction, setGeoFormAction] = useState<
    'ALLOW' | 'BLOCK' | 'ROUTE'
  >('ALLOW');
  const [geoFormPriority, setGeoFormPriority] = useState('0');
  const [geoFormIsActive, setGeoFormIsActive] = useState(true);
  const [geoFormErrors, setGeoFormErrors] = useState<GeoFormErrors>({});

  const filteredGeoRules = useMemo(() => {
    if (chainId === null || chainId === undefined) return geoRules;
    return geoRules.filter((r) => r.chainId === chainId);
  }, [geoRules, chainId]);

  const fetchGeoRules = useCallback(async () => {
    try {
      const response = await fetch('/api/routing/geo');
      const result = await response.json();
      if (!response.ok) {
        setGeoApiError(result.error || 'Failed to fetch geo rules');
        return;
      }
      setGeoRules(result.data);
      setGeoApiError(null);
    } catch {
      setGeoApiError('Network error. Please check your connection.');
    } finally {
      setGeoLoading(false);
    }
  }, []);

  useEffect(() => {
    setGeoLoading(true);
    startTransition(() => {
      fetchGeoRules();
    });
  }, [fetchGeoRules, refreshSignal]);

  const {
    status: geoAutoSaveStatus,
    save: geoAutoSave,
    cancel: cancelGeoAutoSave,
  } = useRoutingAutoSave<GeoRuleCreate>({
    resolveRequest: (id) =>
      id
        ? { url: `/api/routing/geo/${id}`, method: 'PUT' }
        : { url: '/api/routing/geo', method: 'POST' },
    onSuccess: fetchGeoRules,
    onError: setGeoApiError,
  });

  function resetGeoForm() {
    setGeoFormName('');
    setGeoFormMatchType('country');
    setGeoFormCountryCode('');
    setGeoFormRegion('');
    setGeoFormSpecial('domestic');
    setGeoFormAction('ALLOW');
    setGeoFormPriority('0');
    setGeoFormIsActive(true);
    setGeoFormErrors({});
  }

  const openGeoCreateForm = useCallback(() => {
    setGeoEditingRule(null);
    resetGeoForm();
    setGeoShowForm(true);
  }, []);

  const openGeoEditForm = useCallback((rule: GeoRoutingRule) => {
    setGeoEditingRule(rule);
    setGeoFormName(rule.name);
    setGeoFormMatchType(rule.matchType);
    setGeoFormCountryCode(rule.target.countryCode ?? '');
    setGeoFormRegion(rule.target.region ?? '');
    setGeoFormSpecial(rule.target.special ?? 'domestic');
    setGeoFormAction(rule.action);
    setGeoFormPriority(String(rule.priority));
    setGeoFormIsActive(rule.isActive);
    setGeoFormErrors({});
    setGeoShowForm(true);
  }, []);

  const closeGeoForm = useCallback(() => {
    setGeoShowForm(false);
    setGeoEditingRule(null);
    cancelGeoAutoSave();
  }, [cancelGeoAutoSave]);

  const validateGeoForm = useCallback((): boolean => {
    const newErrors: GeoFormErrors = {};
    if (!geoFormName.trim()) newErrors.name = 'Name is required';
    if (
      geoFormMatchType === 'country' &&
      !/^[A-Za-z]{2}$/.test(geoFormCountryCode)
    ) {
      newErrors.countryCode = 'Must be exactly 2 letters';
    }
    if (
      isNaN(parseInt(geoFormPriority, 10)) ||
      parseInt(geoFormPriority, 10) < 0
    ) {
      newErrors.priority = 'Priority must be 0 or greater';
    }
    setGeoFormErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [geoFormName, geoFormMatchType, geoFormCountryCode, geoFormPriority]);

  const handleGeoFieldChange = useCallback(() => {
    if (!geoEditingRule) return; // Only auto-save on edit, not create
    if (!validateGeoForm()) return;

    const target: GeoRuleCreate['target'] = {};
    if (geoFormMatchType === 'country') {
      target.countryCode = geoFormCountryCode.toUpperCase();
    } else if (geoFormMatchType === 'region') {
      target.region = geoFormRegion;
    } else {
      target.special = geoFormSpecial;
    }

    geoAutoSave(
      {
        name: geoFormName.trim(),
        matchType: geoFormMatchType,
        target,
        action: geoFormAction,
        chainId: chainId ?? null,
        priority: parseInt(geoFormPriority, 10) || 0,
        isActive: geoFormIsActive,
      },
      geoEditingRule.id,
    );
  }, [
    geoEditingRule,
    geoFormName,
    geoFormMatchType,
    geoFormCountryCode,
    geoFormRegion,
    geoFormSpecial,
    geoFormAction,
    geoFormPriority,
    geoFormIsActive,
    chainId,
    validateGeoForm,
    geoAutoSave,
  ]);

  const handleGeoCreate = useCallback(() => {
    if (!validateGeoForm()) return;

    const target: GeoRuleCreate['target'] = {};
    if (geoFormMatchType === 'country') {
      target.countryCode = geoFormCountryCode.toUpperCase();
    } else if (geoFormMatchType === 'region') {
      target.region = geoFormRegion;
    } else {
      target.special = geoFormSpecial;
    }

    const data: GeoRuleCreate = {
      name: geoFormName.trim(),
      matchType: geoFormMatchType,
      target,
      action: geoFormAction,
      chainId: chainId ?? null,
      priority: parseInt(geoFormPriority, 10) || 0,
      isActive: geoFormIsActive,
      source: 'custom',
    };

    setGeoSubmitting(true);
    setGeoApiError(null);

    fetch('/api/routing/geo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((result) => {
        if (!result.ok && !result.data) {
          // Response might be ok even without .ok property
        }
        setGeoShowForm(false);
        setGeoEditingRule(null);
        setGeoLoading(true);
        fetchGeoRules();
      })
      .catch(() => {
        setGeoApiError('Network error. Please check your connection.');
      })
      .finally(() => setGeoSubmitting(false));
  }, [
    geoFormName,
    geoFormMatchType,
    geoFormCountryCode,
    geoFormRegion,
    geoFormSpecial,
    geoFormAction,
    geoFormPriority,
    geoFormIsActive,
    chainId,
    validateGeoForm,
    fetchGeoRules,
  ]);

  const handleGeoDelete = useCallback(async () => {
    if (geoDeleteConfirmId === null) return;
    setGeoDeleteLoading(true);
    setGeoApiError(null);
    try {
      const response = await fetch(`/api/routing/geo/${geoDeleteConfirmId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const result = await response.json();
        setGeoApiError(result.error || 'Failed to delete rule');
        return;
      }
      setGeoDeleteConfirmId(null);
      setGeoLoading(true);
      fetchGeoRules();
    } catch {
      setGeoApiError('Network error.');
    } finally {
      setGeoDeleteLoading(false);
    }
  }, [geoDeleteConfirmId, fetchGeoRules]);

  const handleGeoToggle = useCallback(
    async (rule: GeoRoutingRule) => {
      setGeoApiError(null);
      try {
        const response = await fetch(`/api/routing/geo/${rule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !rule.isActive }),
        });
        if (!response.ok) {
          const result = await response.json();
          setGeoApiError(result.error || 'Failed to toggle rule');
          return;
        }
        setGeoLoading(true);
        fetchGeoRules();
      } catch {
        setGeoApiError('Network error.');
      }
    },
    [fetchGeoRules],
  );

  const handleGeoMove = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= filteredGeoRules.length) return;

      const reorderPairs = filteredGeoRules.map((rule, i) => {
        if (i === index)
          return {
            id: rule.id,
            priority: filteredGeoRules[targetIndex].priority,
          };
        if (i === targetIndex)
          return { id: rule.id, priority: filteredGeoRules[index].priority };
        return { id: rule.id, priority: rule.priority };
      });

      setGeoApiError(null);
      try {
        const response = await fetch('/api/routing/geo/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: reorderPairs }),
        });
        if (!response.ok) {
          const result = await response.json();
          setGeoApiError(result.error || 'Failed to reorder rules');
          return;
        }
        setGeoLoading(true);
        fetchGeoRules();
      } catch {
        setGeoApiError('Network error.');
      }
    },
    [filteredGeoRules, fetchGeoRules],
  );

  return (
    <div
      className="p-4 space-y-3"
      role="tabpanel"
      aria-label="Geo routing rules"
    >
      {geoApiError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {geoApiError}
        </div>
      )}

      {geoLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading rules...
          </span>
        </div>
      ) : filteredGeoRules.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No routing rules for this chain. Add rules to control how traffic
            flows through this node.
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
                  Name
                </th>
                <th className="px-2 py-2 font-medium text-muted-foreground">
                  Match
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
              {filteredGeoRules.map((rule, index) => (
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
                        onClick={() => handleGeoMove(index, 'up')}
                        disabled={index === 0}
                        aria-label="Move rule up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        onClick={() => handleGeoMove(index, 'down')}
                        disabled={index === filteredGeoRules.length - 1}
                        aria-label="Move rule down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-sm font-medium">{rule.name}</span>
                  </td>
                  <td className="px-2 py-2">
                    {rule.matchType === 'country' && rule.target.countryCode ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <span>
                          {countryCodeToFlag(rule.target.countryCode)}
                        </span>
                        <code className="rounded bg-muted px-1 py-0.5 font-mono">
                          {rule.target.countryCode}
                        </code>
                      </span>
                    ) : rule.matchType === 'region' ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Globe className="h-3 w-3 text-muted-foreground" />
                        <span>{rule.target.region ?? 'Unknown'}</span>
                      </span>
                    ) : (
                      <span className="text-xs">
                        {rule.target.special === 'domestic'
                          ? 'Domestic'
                          : 'Foreign'}
                      </span>
                    )}
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
                      onChange={() => handleGeoToggle(rule)}
                      className="h-3.5 w-3.5 rounded border-border accent-accent"
                      aria-label="Toggle active"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => openGeoEditForm(rule)}
                        aria-label="Edit rule"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1 text-destructive hover:bg-destructive/10"
                        onClick={() => setGeoDeleteConfirmId(rule.id)}
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

          {/* Geo delete confirmation */}
          {geoDeleteConfirmId !== null && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2">
              <p className="text-sm">
                Are you sure you want to delete this rule?
              </p>
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGeoDeleteConfirmId(null)}
                  disabled={geoDeleteLoading}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleGeoDelete}
                  disabled={geoDeleteLoading}
                >
                  {geoDeleteLoading && (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Inline geo form (accordion) */}
      {geoShowForm && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {geoEditingRule ? 'Edit Rule' : 'New Geo Rule'}
            </span>
            {geoEditingRule && <AutoSaveIndicator status={geoAutoSaveStatus} />}
          </div>

          {/* Name */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              type="text"
              placeholder="e.g., Block CN traffic"
              value={geoFormName}
              onChange={(e) => {
                setGeoFormName(e.target.value);
                if (geoEditingRule) handleGeoFieldChange();
              }}
              disabled={geoSubmitting}
              className={clsx(
                'h-8 text-sm',
                geoFormErrors.name && 'border-destructive',
              )}
            />
            {geoFormErrors.name && (
              <p className="text-xs text-destructive">{geoFormErrors.name}</p>
            )}
          </div>

          {/* Match type */}
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">
              Match Type
            </span>
            <div className="flex gap-3">
              {MATCH_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <input
                    type="radio"
                    name="drawer-geo-match-type"
                    value={opt.value}
                    checked={geoFormMatchType === opt.value}
                    onChange={() => {
                      setGeoFormMatchType(opt.value);
                      if (geoEditingRule) handleGeoFieldChange();
                    }}
                    disabled={geoSubmitting}
                    className="accent-accent"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Country code */}
          {geoFormMatchType === 'country' && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Country Code
              </label>
              <Input
                type="text"
                placeholder="e.g., US, CN"
                value={geoFormCountryCode}
                onChange={(e) => {
                  setGeoFormCountryCode(
                    e.target.value.toUpperCase().slice(0, 2),
                  );
                  if (geoEditingRule) handleGeoFieldChange();
                }}
                disabled={geoSubmitting}
                maxLength={2}
                className={clsx(
                  'h-8 text-sm',
                  geoFormErrors.countryCode && 'border-destructive',
                )}
              />
              {geoFormErrors.countryCode && (
                <p className="text-xs text-destructive">
                  {geoFormErrors.countryCode}
                </p>
              )}
            </div>
          )}

          {/* Region */}
          {geoFormMatchType === 'region' && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Region
              </label>
              <select
                value={geoFormRegion}
                onChange={(e) => {
                  setGeoFormRegion(e.target.value);
                  if (geoEditingRule) handleGeoFieldChange();
                }}
                disabled={geoSubmitting}
                className={clsx(
                  'flex h-8 w-full rounded-md border border-border bg-background px-2 py-1',
                  'text-sm text-foreground',
                )}
              >
                <option value="">Select region...</option>
                {REGION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Special */}
          {geoFormMatchType === 'special' && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Special Match
              </label>
              <select
                value={geoFormSpecial}
                onChange={(e) => {
                  setGeoFormSpecial(e.target.value as 'domestic' | 'foreign');
                  if (geoEditingRule) handleGeoFieldChange();
                }}
                disabled={geoSubmitting}
                className={clsx(
                  'flex h-8 w-full rounded-md border border-border bg-background px-2 py-1',
                  'text-sm text-foreground',
                )}
              >
                {SPECIAL_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

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
                    name="drawer-geo-action"
                    value={opt.value}
                    checked={geoFormAction === opt.value}
                    onChange={() => {
                      setGeoFormAction(opt.value);
                      if (geoEditingRule) handleGeoFieldChange();
                    }}
                    disabled={geoSubmitting}
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
              value={geoFormPriority}
              onChange={(e) => {
                setGeoFormPriority(e.target.value);
                if (geoEditingRule) handleGeoFieldChange();
              }}
              disabled={geoSubmitting}
              className={clsx(
                'h-8 text-sm',
                geoFormErrors.priority && 'border-destructive',
              )}
            />
            {geoFormErrors.priority && (
              <p className="text-xs text-destructive">
                {geoFormErrors.priority}
              </p>
            )}
          </div>

          {/* Active */}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={geoFormIsActive}
              onChange={(e) => {
                setGeoFormIsActive(e.target.checked);
                if (geoEditingRule) handleGeoFieldChange();
              }}
              disabled={geoSubmitting}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Rule is active
          </label>

          {/* Form actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={closeGeoForm}
              disabled={geoSubmitting}
            >
              Cancel
            </Button>
            {!geoEditingRule && (
              <Button
                size="sm"
                onClick={handleGeoCreate}
                disabled={geoSubmitting}
              >
                {geoSubmitting && (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                Create Rule
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Add Rule button */}
      {!geoShowForm && (
        <Button
          variant="outline"
          size="sm"
          onClick={openGeoCreateForm}
          className="w-full"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Rule
        </Button>
      )}
    </div>
  );
}
