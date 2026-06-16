'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ChainBuilderNode } from '@/lib/chain-flow-utils';
import type { ChainTemplate } from '@/types/chain';
import type { RemotePanel } from '@/types/remote-panel';

interface SaveChainDialogProps {
  open: boolean;
  onClose: () => void;
  localNodes: ChainBuilderNode[];
  selectedTemplate: ChainTemplate | null;
  serverPanelMap?: Record<number, number>;
  panels?: RemotePanel[];
  /** Invoked after a successful apply with the template id and server mapping. */
  onApplied: (
    templateId: string,
    serverMapping: Record<number, number>,
  ) => void;
}

export function SaveChainDialog({
  open,
  onClose,
  localNodes,
  selectedTemplate,
  serverPanelMap,
  panels,
  onApplied,
}: SaveChainDialogProps) {
  const [panelApiKeys, setPanelApiKeys] = useState<Record<number, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<number, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveDialogPanels = useMemo(() => {
    if (!serverPanelMap) return [];
    const seen = new Set<number>();
    return localNodes
      .filter(
        (n) => n.serverId !== null && serverPanelMap[n.serverId] !== undefined,
      )
      .filter((n) => {
        const panelId = serverPanelMap[n.serverId!];
        if (seen.has(panelId)) return false;
        seen.add(panelId);
        return true;
      })
      .map((n) => {
        const panelId = serverPanelMap[n.serverId!];
        const panel = panels?.find((p) => p.id === panelId);
        return { panelId, panelName: panel?.name ?? `Panel ${panelId}` };
      });
  }, [localNodes, serverPanelMap, panels]);

  const handleSaveDirect = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const assignedNodes = localNodes.filter(
        (n): n is ChainBuilderNode & { serverId: number } =>
          n.serverId !== null,
      );
      const serverMapping = Object.fromEntries(
        assignedNodes.map((n, i) => [i, n.serverId] as const),
      ) as Record<number, number>;

      const response = await fetch('/api/chains/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate?.id ?? 'custom',
          serverMapping,
          panelApiKeys,
        }),
      });
      const result = await response.json();
      if (result.success) {
        onApplied(selectedTemplate?.id ?? 'custom', serverMapping);
        onClose();
      } else {
        setSaveError(result.error ?? 'Failed to apply chain configuration');
      }
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Failed to apply chain configuration',
      );
    } finally {
      setSaving(false);
    }
  }, [localNodes, selectedTemplate, panelApiKeys, onApplied, onClose]);

  // No panels to collect keys for — save directly without showing the form.
  const ranDirectSaveRef = useRef(false);
  useEffect(() => {
    if (open && saveDialogPanels.length === 0 && !ranDirectSaveRef.current) {
      ranDirectSaveRef.current = true;
      handleSaveDirect();
    }
    if (!open) {
      ranDirectSaveRef.current = false;
    }
  }, [open, saveDialogPanels.length, handleSaveDirect]);

  if (!open) return null;
  // No panels to collect keys for -- render nothing while the direct-save
  // effect applies the chain, matching the original no-dialog save path.
  if (saveDialogPanels.length === 0) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Provide API Keys">
      <p className="text-sm text-muted-foreground mb-4">
        Enter the shared secret for each panel to apply the chain configuration.
      </p>
      <div className="space-y-3">
        {saveDialogPanels.map(({ panelId, panelName }) => (
          <div key={panelId}>
            <label className="text-xs font-medium text-foreground mb-1 block">
              API Key for {panelName}
            </label>
            <div className="relative">
              <Input
                type={visibleKeys[panelId] ? 'text' : 'password'}
                placeholder={`Enter shared secret for ${panelName}`}
                value={panelApiKeys[panelId] ?? ''}
                onChange={(e) =>
                  setPanelApiKeys((prev) => ({
                    ...prev,
                    [panelId]: e.target.value,
                  }))
                }
                className="pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleKeys((prev) => ({
                    ...prev,
                    [panelId]: !prev[panelId],
                  }))
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={
                  visibleKeys[panelId] ? 'Hide API key' : 'Show API key'
                }
              >
                {visibleKeys[panelId] ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
      {saveError && (
        <p className="mt-3 text-sm text-destructive">{saveError}</p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSaveDirect}
          disabled={
            saving ||
            saveDialogPanels.some(
              (p) => !(panelApiKeys[p.panelId] ?? '').trim(),
            )
          }
        >
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          Apply to Panels
        </Button>
      </div>
    </Dialog>
  );
}
