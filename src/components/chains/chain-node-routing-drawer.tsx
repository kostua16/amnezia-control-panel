'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Check, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { TemplateGallery } from '@/components/routing/template-gallery';
import { GeoRoutingForm } from '@/components/chains/geo-routing-form';
import { IpDomainRoutingForm } from '@/components/chains/ip-domain-routing-form';
import type { ChainBuilderNode } from '@/lib/chain-flow-utils';
import type { ChainNode } from '@/types/chain';

// ─── Constants ───────────────────────────────────────────

const TABS = [
  { id: 'geo', label: 'Geo' },
  { id: 'ip-domain', label: 'IP & Domain' },
  { id: 'templates', label: 'Templates' },
] as const;

type TabId = (typeof TABS)[number]['id'];

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

// ─── Types ───────────────────────────────────────────────

interface ChainNodeRoutingDrawerProps {
  open: boolean;
  onClose: () => void;
  node: ChainBuilderNode | null;
  chainId?: number | null;
}

// ─── Component ───────────────────────────────────────────

export function ChainNodeRoutingDrawer({
  open,
  onClose,
  node,
  chainId,
}: ChainNodeRoutingDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('geo');
  const [refreshSignal, setRefreshSignal] = useState(0);

  // ── Apply to Panels state ────────────────────────────
  const [applyLoading, setApplyLoading] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

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

  // ─── Reset shell state when drawer closes ───────────
  useEffect(() => {
    if (!open) {
      setActiveTab('geo');
      setApplyLoading(false);
      setApplySuccess(false);
      setApplyError(null);
    }
  }, [open]);

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
    setRefreshSignal((n) => n + 1);
  }, []);

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

        {/* Tab content — geo/IP forms stay mounted so their state persists across tab switches */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ height: 'calc(100vh - 180px)' }}
        >
          <div className={clsx(activeTab !== 'geo' && 'hidden')}>
            <GeoRoutingForm chainId={chainId} refreshSignal={refreshSignal} />
          </div>

          <div className={clsx(activeTab !== 'ip-domain' && 'hidden')}>
            <IpDomainRoutingForm refreshSignal={refreshSignal} />
          </div>

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
