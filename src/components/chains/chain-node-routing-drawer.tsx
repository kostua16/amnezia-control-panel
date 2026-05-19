'use client';

import { useState, useEffect, useCallback, useRef, useMemo, startTransition } from 'react';
import {
  X,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Globe,
  Check,
  Upload,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TemplateGallery } from '@/components/routing/template-gallery';
import type { ChainBuilderNode } from '@/lib/chain-flow-utils';
import type { ChainNode } from '@/types/chain';
import type {
  GeoRoutingRule,
  GeoRuleCreate,
  GeoMatchType,
} from '@/types/geo-routing';
import type {
  RoutingRule,
  RoutingRuleCreate,
  RuleProtocol,
  RuleAction,
  ReorderPair,
} from '@/types/routing';

// ─── Constants ───────────────────────────────────────────

const TABS = [
  { id: 'geo', label: 'Geo' },
  { id: 'ip-domain', label: 'IP & Domain' },
  { id: 'templates', label: 'Templates' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const MATCH_TYPE_OPTIONS: { value: GeoMatchType; label: string }[] = [
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'special', label: 'Special' },
];

const REGION_OPTIONS = [
  'Europe',
  'Asia-Pacific',
  'North America',
  'South America',
  'Africa',
  'Middle East',
];

const SPECIAL_OPTIONS = [
  { value: 'domestic' as const, label: 'Domestic' },
  { value: 'foreign' as const, label: 'Foreign' },
];

const GEO_ACTION_OPTIONS: {
  value: 'ALLOW' | 'BLOCK' | 'ROUTE';
  label: string;
}[] = [
  { value: 'ALLOW', label: 'Allow' },
  { value: 'BLOCK', label: 'Block' },
  { value: 'ROUTE', label: 'Route' },
];

const ROUTING_ACTION_OPTIONS: { value: RuleAction; label: string }[] = [
  { value: 'ALLOW', label: 'Allow' },
  { value: 'BLOCK', label: 'Block' },
  { value: 'ROUTE', label: 'Route' },
];

const PROTOCOL_OPTIONS: { value: RuleProtocol; label: string }[] = [
  { value: 'ANY', label: 'Any' },
  { value: 'WIREGUARD', label: 'WireGuard' },
  { value: 'VLESS', label: 'VLESS' },
  { value: 'VMESS', label: 'VMess' },
  { value: 'TROJAN', label: 'Trojan' },
  { value: 'SHADOWSOCKS', label: 'Shadowsocks' },
];

const roleColors: Record<ChainNode['role'], string> = {
  entry: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  middle: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  exit: 'bg-green-500/20 text-green-400 border-green-500/30',
  domestic: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  foreign: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

const roleLabels: Record<ChainNode['role'], string> = {
  entry: 'Entry',
  middle: 'Middle',
  exit: 'Exit',
  domestic: 'Domestic',
  foreign: 'Foreign',
};

// ─── Helpers (copied from geo-rules-list.tsx) ───────────

function countryCodeToFlag(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

function geoActionLabel(action: string): string {
  const labels: Record<string, string> = {
    ALLOW: 'Allow',
    BLOCK: 'Block',
    ROUTE: 'Route',
  };
  return labels[action] ?? action;
}

function geoActionStyle(action: string): string {
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

// ─── Types ───────────────────────────────────────────────

interface ChainNodeRoutingDrawerProps {
  open: boolean;
  onClose: () => void;
  node: ChainBuilderNode | null;
  chainId?: number | null;
}

interface GeoFormErrors {
  name?: string;
  countryCode?: string;
  priority?: string;
}

interface RoutingFormErrors {
  destination?: string;
  priority?: string;
}

type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function AutoSaveIndicator({ status }: { status: AutoSaveStatus }) {
  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-500">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        Error
      </span>
    );
  }
  return null;
}

// ─── Component ───────────────────────────────────────────

export function ChainNodeRoutingDrawer({
  open,
  onClose,
  node,
  chainId,
}: ChainNodeRoutingDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('geo');

  // ── Geo rules state ──────────────────────────────────
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

  // Geo form state
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

  // Auto-save state for geo edit form
  const geoAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [geoAutoSaveStatus, setGeoAutoSaveStatus] =
    useState<AutoSaveStatus>('idle');

  // ── IP/domain rules state ────────────────────────────
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

  // Routing form state
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

  // Auto-save state for routing edit form
  const routingAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [routingAutoSaveStatus, setRoutingAutoSaveStatus] =
    useState<AutoSaveStatus>('idle');

  // ── Apply to Panels state ────────────────────────────
  const [applyLoading, setApplyLoading] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Filtered rules by chainId
  const filteredGeoRules = useMemo(() => {
    if (chainId === null || chainId === undefined) return geoRules;
    return geoRules.filter((r) => r.chainId === chainId);
  }, [geoRules, chainId]);

  // ─── Data fetching ──────────────────────────────────

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
    if (!open) return;
    startTransition(() => { fetchGeoRules(); fetchRoutingRules(); });
  }, [open, fetchGeoRules, fetchRoutingRules]);

  // ─── Body scroll lock ───────────────────────────────

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

  // ─── Escape to close ────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ─── Cleanup debounce timers ────────────────────────

  useEffect(() => {
    return () => {
      if (geoAutoSaveTimerRef.current)
        clearTimeout(geoAutoSaveTimerRef.current);
      if (routingAutoSaveTimerRef.current)
        clearTimeout(routingAutoSaveTimerRef.current);
    };
  }, []);

  // ─── Reset form state when drawer closes ────────────

  useEffect(() => {
    if (!open) {
      startTransition(() => {
        setActiveTab('geo');
        setGeoShowForm(false);
        setGeoEditingRule(null);
        setGeoDeleteConfirmId(null);
        setGeoApiError(null);
        resetGeoForm();
        setGeoAutoSaveStatus('idle');
        setRoutingShowForm(false);
        setRoutingEditingRule(null);
        setRoutingDeleteConfirmId(null);
        setRoutingApiError(null);
        resetRoutingForm();
        setRoutingAutoSaveStatus('idle');
        setApplyLoading(false);
        setApplySuccess(false);
        setApplyError(null);
      });
    }
  }, [open]);

  // ─── Geo rule handlers ──────────────────────────────

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
    setGeoAutoSaveStatus('idle');
    setGeoShowForm(true);
  }, []);

  const closeGeoForm = useCallback(() => {
    setGeoShowForm(false);
    setGeoEditingRule(null);
    if (geoAutoSaveTimerRef.current) clearTimeout(geoAutoSaveTimerRef.current);
    setGeoAutoSaveStatus('idle');
  }, []);

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

  const geoAutoSave = useCallback(
    (data: GeoRuleCreate, ruleId?: number) => {
      if (geoAutoSaveTimerRef.current)
        clearTimeout(geoAutoSaveTimerRef.current);

      setGeoAutoSaveStatus('saving');

      geoAutoSaveTimerRef.current = setTimeout(async () => {
        try {
          const url = ruleId
            ? `/api/routing/geo/${ruleId}`
            : '/api/routing/geo';
          const method = ruleId ? 'PUT' : 'POST';
          const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!response.ok) {
            const result = await response.json();
            setGeoApiError(result.error || 'Failed to save rule');
            setGeoAutoSaveStatus('error');
            return;
          }
          setGeoAutoSaveStatus('saved');
          setTimeout(() => setGeoAutoSaveStatus('idle'), 1000);
          fetchGeoRules();
        } catch {
          setGeoApiError('Network error.');
          setGeoAutoSaveStatus('error');
        }
      }, 500);
    },
    [fetchGeoRules],
  );

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

  // ─── Routing rule handlers ──────────────────────────

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
    setRoutingAutoSaveStatus('idle');
    setRoutingShowForm(true);
  }, []);

  const closeRoutingForm = useCallback(() => {
    setRoutingShowForm(false);
    setRoutingEditingRule(null);
    if (routingAutoSaveTimerRef.current)
      clearTimeout(routingAutoSaveTimerRef.current);
    setRoutingAutoSaveStatus('idle');
  }, []);

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

  const routingAutoSave = useCallback(
    (data: RoutingRuleCreate, ruleId?: number) => {
      if (routingAutoSaveTimerRef.current)
        clearTimeout(routingAutoSaveTimerRef.current);

      setRoutingAutoSaveStatus('saving');

      routingAutoSaveTimerRef.current = setTimeout(async () => {
        try {
          const url = ruleId
            ? `/api/routing/rules/${ruleId}`
            : '/api/routing/rules';
          const method = ruleId ? 'PUT' : 'POST';
          const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!response.ok) {
            const result = await response.json();
            setRoutingApiError(result.error || 'Failed to save rule');
            setRoutingAutoSaveStatus('error');
            return;
          }
          setRoutingAutoSaveStatus('saved');
          setTimeout(() => setRoutingAutoSaveStatus('idle'), 1000);
          fetchRoutingRules();
        } catch {
          setRoutingApiError('Network error.');
          setRoutingAutoSaveStatus('error');
        }
      }, 500);
    },
    [fetchRoutingRules],
  );

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

  // ─── Apply to Panels handler ────────────────────────

  const handleApplyToPanels = useCallback(async () => {
    setApplyLoading(true);
    setApplySuccess(false);
    setApplyError(null);
    try {
      const response = await fetch('/api/chains/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok) {
        setApplyError(result.error || 'Failed to apply configuration');
        return;
      }
      setApplySuccess(true);
      setTimeout(() => setApplySuccess(false), 2000);
    } catch {
      setApplyError('Network error. Please check your connection.');
    } finally {
      setApplyLoading(false);
    }
  }, []);

  // ─── Template applied handler ───────────────────────

  const handleTemplateApplied = useCallback(() => {
    setActiveTab('geo');
    setGeoLoading(true);
    fetchGeoRules();
    setRoutingLoading(true);
    fetchRoutingRules();
  }, [fetchGeoRules, fetchRoutingRules]);

  // ─── Guard ──────────────────────────────────────────

  if (!open || !node) return null;

  // ─── Render ─────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-[480px] max-w-full border-l border-border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold">
                {node.label}
              </span>
              <span
                className={clsx(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase',
                  roleColors[node.role],
                )}
              >
                {roleLabels[node.role]}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Routing Rules
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={clsx(
                'flex-1 px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ height: 'calc(100vh - 180px)' }}
        >
          {/* ── Geo Tab ────────────────────────────── */}
          {activeTab === 'geo' && (
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
                    No routing rules for this chain. Add rules to control how
                    traffic flows through this node.
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
                            <span className="text-sm font-medium">
                              {rule.name}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            {rule.matchType === 'country' &&
                            rule.target.countryCode ? (
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
                                geoActionStyle(rule.action),
                              )}
                            >
                              {geoActionLabel(rule.action)}
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
                    {geoEditingRule && (
                      <AutoSaveIndicator status={geoAutoSaveStatus} />
                    )}
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
                      <p className="text-xs text-destructive">
                        {geoFormErrors.name}
                      </p>
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
                          setGeoFormSpecial(
                            e.target.value as 'domestic' | 'foreign',
                          );
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
                      {GEO_ACTION_OPTIONS.map((opt) => (
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
          )}

          {/* ── IP & Domain Tab ────────────────────── */}
          {activeTab === 'ip-domain' && (
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
                                geoActionStyle(rule.action),
                              )}
                            >
                              {geoActionLabel(rule.action)}
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
                                onClick={() =>
                                  setRoutingDeleteConfirmId(rule.id)
                                }
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
                      {ROUTING_ACTION_OPTIONS.map((opt) => (
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
                              if (routingEditingRule)
                                handleRoutingFieldChange();
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
          )}

          {/* ── Templates Tab ───────────────────────── */}
          {activeTab === 'templates' && (
            <div
              className="p-4"
              role="tabpanel"
              aria-label="Routing rule templates"
            >
              <TemplateGallery onApplied={handleTemplateApplied} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4">
          {applyError && (
            <p className="mb-2 text-xs text-destructive">{applyError}</p>
          )}
          <p className="mb-3 text-xs text-muted-foreground">
            Changes are saved automatically.
          </p>
          <Button
            variant="default"
            size="sm"
            onClick={handleApplyToPanels}
            disabled={applyLoading}
            className="w-full"
          >
            {applyLoading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : applySuccess ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            {applyLoading
              ? 'Applying...'
              : applySuccess
                ? 'Applied'
                : 'Apply to Panels'}
          </Button>
        </div>
      </div>
    </>
  );
}
