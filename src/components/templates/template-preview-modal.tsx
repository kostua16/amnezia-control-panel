'use client';

import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ConfigTemplate, ConfigPreset } from '@/types/config';
import type { RoutingRuleTemplate } from '@/types/routing-rule-template';
import type { ChainPreset } from '@/types/chain-preset';

type PreviewItem =
  | { type: 'protocol'; data: ConfigTemplate }
  | { type: 'server'; data: ConfigPreset }
  | { type: 'routing'; data: RoutingRuleTemplate }
  | { type: 'chain'; data: ChainPreset };

interface TemplatePreviewModalProps {
  open: boolean;
  onClose: () => void;
  item: PreviewItem | null;
}

const topologyBadgeClasses: Record<string, string> = {
  linear: 'bg-blue-500/10 text-blue-400',
  split: 'bg-amber-500/10 text-amber-400',
  mesh: 'bg-green-500/10 text-green-400',
};

interface RuleRow {
  name: string;
  matchType: string;
  countryCode?: string;
  action: string;
  priority: number;
}

function KeyValueTable({ entries }: { entries: [string, string][] }) {
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex justify-between text-sm">
          <span className="text-muted-foreground">{key}</span>
          <span className="text-foreground font-medium">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function RulesTable({ rules }: { rules: RuleRow[] }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Match</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Action</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rules.map((rule, i) => (
            <tr key={i}>
              <td className="px-3 py-2">{rule.name}</td>
              <td className="px-3 py-2">
                {rule.matchType}
                {rule.countryCode ? ` (${rule.countryCode})` : ''}
              </td>
              <td className="px-3 py-2">{rule.action}</td>
              <td className="px-3 py-2">{rule.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TemplatePreviewModal({ open, onClose, item }: TemplatePreviewModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open || !item) return null;

  let title = '';
  let content: React.ReactNode = null;

  switch (item.type) {
    case 'protocol': {
      const t = item.data;
      title = t.name;
      const contentEntries: [string, string][] = [
        ['Protocol', t.protocol],
        ['Service Type', t.serviceType ?? 'Any'],
      ];
      if (t.content && typeof t.content === 'object') {
        for (const [k, v] of Object.entries(t.content)) {
          contentEntries.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
        }
      }
      content = (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t.description}</p>
          <KeyValueTable entries={contentEntries} />
        </div>
      );
      break;
    }
    case 'server': {
      const p = item.data;
      title = p.label;
      const settings = p.settings ?? {};
      const settingsEntries: [string, string][] = [
        ['OS', String(settings.os ?? 'Ubuntu 24.04')],
        ['Protocol', p.protocol],
        ['Service Type', p.serviceType],
      ];
      if (settings.mtu) settingsEntries.push(['MTU', String(settings.mtu)]);
      if (settings.dns) settingsEntries.push(['DNS', String(settings.dns)]);
      if (settings.sysctl && typeof settings.sysctl === 'object') {
        for (const [k, v] of Object.entries(settings.sysctl)) {
          settingsEntries.push([`Sysctl: ${k}`, String(v)]);
        }
      }
      content = (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{p.description}</p>
          <KeyValueTable entries={settingsEntries} />
        </div>
      );
      break;
    }
    case 'routing': {
      const r = item.data;
      title = r.name;
      const rules = (r.rules ?? []) as RuleRow[];
      content = (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{r.description}</p>
          <div className="text-xs text-muted-foreground">
            {rules.length} rule{rules.length !== 1 ? 's' : ''} in this template
          </div>
          {rules.length > 0 ? <RulesTable rules={rules} /> : (
            <p className="text-sm text-muted-foreground">No rules defined.</p>
          )}
        </div>
      );
      break;
    }
    case 'chain': {
      const c = item.data;
      title = c.name;
      const overrides = c.protocolOverrides ?? {};
      const nodeEntries = Object.entries(overrides);
      content = (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{c.description}</p>
          {nodeEntries.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">Nodes</h3>
              <div className="space-y-1">
                {nodeEntries.map(([role, config]) => (
                  <div key={role} className="text-sm">
                    <span className="font-medium">{role}</span>
                    {typeof config === 'object' && config !== null && 'protocol' in config && (
                      <span className="ml-2 text-muted-foreground">({String((config as { protocol: string }).protocol)})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <KeyValueTable
            entries={[
              ['Topology', c.topology],
              ['Node Count', String(c.nodeCount)],
              ['Chain Template', c.chainTemplateId],
              ['Routing Bundle', c.routingBundleId ?? 'None'],
            ]}
          />
        </div>
      );
      break;
    }
  }

  const isBuiltIn =
    (item.type === 'protocol' && item.data.isBuiltIn) ||
    (item.type === 'routing' && item.data.isBuiltIn) ||
    (item.type === 'chain' && item.data.isBuiltIn);
  const topology = item.type === 'chain' ? item.data.topology : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-50 w-full max-w-lg rounded-lg border border-border bg-background text-foreground shadow-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            {isBuiltIn && (
              <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">
                Built-in
              </span>
            )}
            {topology && (
              <span className={`text-xs rounded-full px-2 py-0.5 ${topologyBadgeClasses[topology] ?? 'bg-muted text-muted-foreground'}`}>
                {topology.charAt(0).toUpperCase() + topology.slice(1)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {content}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
