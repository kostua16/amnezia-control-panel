'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GeoRoutingRule, GeoRuleCreate, GeoMatchType } from '@/types/geo-routing';

// ─── Constants ───────────────────────────────────────────

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

const ACTION_OPTIONS: { value: 'ALLOW' | 'BLOCK' | 'ROUTE'; label: string }[] = [
  { value: 'ALLOW', label: 'Allow' },
  { value: 'BLOCK', label: 'Block' },
  { value: 'ROUTE', label: 'Route' },
];

// ─── Types ───────────────────────────────────────────────

interface GeoRuleDrawerProps {
  open: boolean;
  onClose: () => void;
  rule?: GeoRoutingRule | null;
  onSubmit: (data: GeoRuleCreate) => void;
  loading?: boolean;
}

interface FormErrors {
  name?: string;
  countryCode?: string;
  priority?: string;
}

// ─── Component ───────────────────────────────────────────

export function GeoRuleDrawer({ open, onClose, rule, onSubmit, loading = false }: GeoRuleDrawerProps) {
  const isEdit = rule !== null && rule !== undefined;

  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<GeoMatchType>('country');
  const [countryCode, setCountryCode] = useState('');
  const [region, setRegion] = useState('');
  const [special, setSpecial] = useState<'domestic' | 'foreign'>('domestic');
  const [action, setAction] = useState<'ALLOW' | 'BLOCK' | 'ROUTE'>('ALLOW');
  const [chainId, setChainId] = useState('');
  const [priority, setPriority] = useState('0');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Populate form from rule on edit
  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setMatchType(rule.matchType);
      setCountryCode(rule.target.countryCode ?? '');
      setRegion(rule.target.region ?? '');
      setSpecial(rule.target.special ?? 'domestic');
      setAction(rule.action);
      setChainId(rule.chainId != null ? String(rule.chainId) : '');
      setPriority(String(rule.priority));
      setIsActive(rule.isActive);
    } else {
      setName('');
      setMatchType('country');
      setCountryCode('');
      setRegion('');
      setSpecial('domestic');
      setAction('ALLOW');
      setChainId('');
      setPriority('0');
      setIsActive(true);
    }
    setErrors({});
    setTouched({});
  }, [rule, open]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
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

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) newErrors.name = 'Name is required';

    if (matchType === 'country') {
      if (!/^[A-Za-z]{2}$/.test(countryCode)) {
        newErrors.countryCode = 'Must be exactly 2 letters (ISO 3166-1 alpha-2)';
      }
    }

    if (isNaN(parseInt(priority, 10)) || parseInt(priority, 10) < 0) {
      newErrors.priority = 'Priority must be 0 or greater';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, matchType, countryCode, priority]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, countryCode: true, priority: true });

    if (!validate()) return;

    const target: GeoRuleCreate['target'] = {};
    if (matchType === 'country') {
      target.countryCode = countryCode.toUpperCase();
    } else if (matchType === 'region') {
      target.region = region;
    } else {
      target.special = special;
    }

    onSubmit({
      name: name.trim(),
      matchType,
      target,
      action,
      chainId: chainId ? parseInt(chainId, 10) : null,
      priority: parseInt(priority, 10) || 0,
      isActive,
      source: isEdit ? (rule?.source) : 'custom',
    });
  };

  const showError = (field: string, error?: string) => touched[field] && error;

  if (!open) return null;

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
          <h2 className="text-lg font-bold">{isEdit ? 'Edit Geo Rule' : 'Create Geo Rule'}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Name */}
            <div className="space-y-1">
              <label htmlFor="geo-rule-name" className="block text-sm font-medium text-foreground">
                Name
              </label>
              <Input
                id="geo-rule-name"
                type="text"
                placeholder="e.g., Block CN traffic"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, name: true }))}
                disabled={loading}
                className={clsx(showError('name', errors.name) && 'border-destructive')}
              />
              {showError('name', errors.name) && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>

            {/* Match type */}
            <div className="space-y-1">
              <span className="block text-sm font-medium text-foreground">Match Type</span>
              <div className="flex gap-3">
                {MATCH_TYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="geo-match-type"
                      value={opt.value}
                      checked={matchType === opt.value}
                      onChange={() => setMatchType(opt.value)}
                      disabled={loading}
                      className="accent-accent"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Country code (shown when matchType = country) */}
            {matchType === 'country' && (
              <div className="space-y-1">
                <label htmlFor="geo-country-code" className="block text-sm font-medium text-foreground">
                  Country Code
                </label>
                <Input
                  id="geo-country-code"
                  type="text"
                  placeholder="e.g., US, CN, DE"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value.toUpperCase().slice(0, 2))}
                  onBlur={() => setTouched((p) => ({ ...p, countryCode: true }))}
                  disabled={loading}
                  maxLength={2}
                  className={clsx(showError('countryCode', errors.countryCode) && 'border-destructive')}
                />
                {showError('countryCode', errors.countryCode) && (
                  <p className="text-xs text-destructive">{errors.countryCode}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  ISO 3166-1 alpha-2 code (2 uppercase letters).
                </p>
              </div>
            )}

            {/* Region (shown when matchType = region) */}
            {matchType === 'region' && (
              <div className="space-y-1">
                <label htmlFor="geo-region" className="block text-sm font-medium text-foreground">
                  Region
                </label>
                <select
                  id="geo-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  disabled={loading}
                  className={clsx(
                    'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2',
                    'text-sm text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  <option value="">Select region...</option>
                  {REGION_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Special (shown when matchType = special) */}
            {matchType === 'special' && (
              <div className="space-y-1">
                <label htmlFor="geo-special" className="block text-sm font-medium text-foreground">
                  Special Match
                </label>
                <select
                  id="geo-special"
                  value={special}
                  onChange={(e) => setSpecial(e.target.value as 'domestic' | 'foreign')}
                  disabled={loading}
                  className={clsx(
                    'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2',
                    'text-sm text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {SPECIAL_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Action */}
            <div className="space-y-1">
              <span className="block text-sm font-medium text-foreground">Action</span>
              <div className="flex gap-3">
                {ACTION_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="geo-action"
                      value={opt.value}
                      checked={action === opt.value}
                      onChange={() => setAction(opt.value)}
                      disabled={loading}
                      className="accent-accent"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Chain (only if Route) */}
            {action === 'ROUTE' && (
              <div className="space-y-1">
                <label htmlFor="geo-chain-id" className="block text-sm font-medium text-foreground">
                  Chain ID
                </label>
                <Input
                  id="geo-chain-id"
                  type="number"
                  min={1}
                  placeholder="Chain ID"
                  value={chainId}
                  onChange={(e) => setChainId(e.target.value)}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  The chain to route matching traffic through.
                </p>
              </div>
            )}

            {/* Priority */}
            <div className="space-y-1">
              <label htmlFor="geo-priority" className="block text-sm font-medium text-foreground">
                Priority
              </label>
              <Input
                id="geo-priority"
                type="number"
                min={0}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, priority: true }))}
                disabled={loading}
                className={clsx(showError('priority', errors.priority) && 'border-destructive')}
              />
              {showError('priority', errors.priority) && (
                <p className="text-xs text-destructive">{errors.priority}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Lower values are evaluated first (higher priority).
              </p>
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="geo-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={loading}
                className="h-4 w-4 rounded border-border accent-accent"
              />
              <label htmlFor="geo-active" className="text-sm text-foreground">
                Rule is active
              </label>
            </div>
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
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? 'Save Changes' : 'Create Rule'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
