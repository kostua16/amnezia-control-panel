'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Check, ArrowLeft, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { PanelSelector } from './panel-selector';
import { ConfigDiffView } from './config-diff-view';
import { PushProgressTracker } from './push-progress-tracker';
import { PushResultSummary } from './push-result-summary';
import { useWebSocket } from '@/hooks/use-websocket';
import type { ConfigDiffResult, PushProgressEvent } from '@/types/config-push';
import type { PushResult, PushAllResult } from '@/types/panel-sync';

type WizardStep = 1 | 2 | 3 | 4;

interface PushWizardPanel {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PushWizardProps {
  panels: PushWizardPanel[];
}

const STEP_LABELS = [
  '1. Select Panels',
  '2. Preview Changes',
  '3. Push',
  '4. Results',
] as const;

export function PushWizard({ panels }: PushWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<number>>(new Set());
  const [diffResults, setDiffResults] = useState<ConfigDiffResult[]>([]);
  const [pushResults, setPushResults] = useState<PushAllResult | null>(null);
  const [pushProgress, setPushProgress] = useState<Map<number, PushProgressEvent>>(new Map());
  const [isPushing, setIsPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Track which chain config we're pushing (fetched from apply response or pre-built)
  const chainConfigRef = useRef<unknown>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { isConnected, lastEvent } = useWebSocket({
    events: ['panel:push-progress'],
  });

  // Handle WebSocket push progress events
  useEffect(() => {
    const progressEvent = lastEvent['panel:push-progress'] as PushProgressEvent | undefined;
    if (progressEvent) {
      setPushProgress((prev) => {
        const next = new Map(prev);
        next.set(progressEvent.panelId, progressEvent);
        return next;
      });
    }
  }, [lastEvent]);

  // Auto-advance to step 4 when all panels complete
  useEffect(() => {
    if (currentStep !== 3 || !isPushing) return;

    const selectedIds = Array.from(selectedPanelIds);
    if (selectedIds.length === 0) return;

    const allDone = selectedIds.every((id) => {
      const event = pushProgress.get(id);
      return event && (event.status === 'success' || event.status === 'failed');
    });

    if (allDone) {
      setIsPushing(false);
      stopPolling();

      // Build PushAllResult from progress events
      const results: PushResult[] = selectedIds.map((id) => {
        const event = pushProgress.get(id);
        const panel = panels.find((p) => p.id === id);
        return {
          panelId: id,
          panelName: panel?.name ?? `Panel ${id}`,
          success: event?.status === 'success',
          configVersion: null,
          latencyMs: event?.latencyMs ?? null,
          error: event?.error?.message ?? null,
          retries: 0,
        };
      });

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      setPushResults({
        totalPanels: selectedIds.length,
        succeeded,
        failed,
        results,
        configVersion: 0,
        pushedAt: new Date().toISOString(),
      });
      setCurrentStep(4);
    }
  }, [currentStep, isPushing, pushProgress, selectedPanelIds, panels]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/panels/push/status');
        const json = await res.json();
        if (json.success && json.data?.events) {
          for (const event of json.data.events as PushProgressEvent[]) {
            setPushProgress((prev) => {
              const next = new Map(prev);
              next.set(event.panelId, event);
              return next;
            });
          }
        }
      } catch {
        // Polling error is non-critical
      }
    }, 30_000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const handleNextToDiff = useCallback(async () => {
    if (selectedPanelIds.size === 0 || !chainConfigRef.current) return;

    setDiffLoading(true);
    setPushError(null);

    try {
      const res = await fetch('/api/panels/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainConfig: chainConfigRef.current }),
      });
      const json = await res.json();

      if (json.success) {
        setDiffResults(json.data.diffs ?? []);
        setCurrentStep(2);
      } else {
        setPushError(json.error ?? 'Failed to compute diff');
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Failed to compute diff');
    } finally {
      setDiffLoading(false);
    }
  }, [selectedPanelIds]);

  const handlePush = useCallback(async () => {
    if (!chainConfigRef.current) return;

    setIsPushing(true);
    setPushError(null);
    setPushProgress(new Map());

    // Start polling fallback if WebSocket not connected
    if (!isConnected) {
      startPolling();
    }

    try {
      const panelIds = Array.from(selectedPanelIds);
      const panelApiKeys: Record<number, string> = {};
      // For each selected panel, we need the API key.
      // The push API requires plaintext API keys.
      // We send an empty map -- the server will use cached keys from previous connections.
      for (const id of panelIds) {
        panelApiKeys[id] = '';
      }

      const res = await fetch('/api/panels/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainConfig: chainConfigRef.current,
          panelApiKeys,
        }),
      });
      const json = await res.json();

      if (json.success) {
        // Push initiated successfully -- real-time updates via WebSocket
        setCurrentStep(3);
      } else {
        setIsPushing(false);
        stopPolling();
        setPushError(json.error ?? 'Push failed');
      }
    } catch (err) {
      setIsPushing(false);
      stopPolling();
      setPushError(err instanceof Error ? err.message : 'Push failed');
    }
  }, [selectedPanelIds, isConnected, startPolling, stopPolling]);

  const handleRollback = useCallback(async (panelId: number) => {
    try {
      const res = await fetch('/api/panels/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelId, apiKey: '' }),
      });
      const json = await res.json();

      if (json.success) {
        setPushResults((prev: PushAllResult | null) => {
          if (!prev) return prev;
          return {
            ...prev,
            results: prev.results.map((r: PushResult) =>
              r.panelId === panelId
                ? { ...r, error: 'Rolled back successfully' }
                : r,
            ),
          };
        });
      }
    } catch (err) {
      console.error('Rollback failed:', err);
    }
  }, []);

  const handleRetry = useCallback(() => {
    setPushResults(null);
    setPushProgress(new Map());
    setDiffResults([]);
    setSelectedPanelIds(new Set());
    setCurrentStep(1);
    setPushError(null);
  }, []);

  // Render step indicator bar
  const renderStepIndicator = () => (
    <div className="flex items-center gap-1 mb-6">
      {STEP_LABELS.map((label, idx) => {
        const stepNum = (idx + 1) as WizardStep;
        const isActive = stepNum === currentStep;
        const isCompleted = stepNum < currentStep;

        return (
          <div key={label} className="flex items-center gap-1">
            <div
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
                isActive && 'bg-accent/10 text-accent font-bold',
                isCompleted && 'text-green-500',
                !isActive && !isCompleted && 'text-muted-foreground',
              )}
            >
              {isCompleted && <Check className="h-3.5 w-3.5" />}
              <span>{label}</span>
            </div>
            {idx < STEP_LABELS.length - 1 && (
              <span className="text-muted-foreground mx-1">{'>'}</span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6">
        {renderStepIndicator()}

        {pushError && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {pushError}
          </div>
        )}

        {/* Step 1: Select Panels */}
        {currentStep === 1 && (
          <PanelSelector
            panels={panels}
            selectedPanelIds={selectedPanelIds}
            onSelectionChange={setSelectedPanelIds}
          />
        )}

        {/* Step 2: Preview Changes */}
        {currentStep === 2 && (
          <ConfigDiffView diffResults={diffResults} />
        )}

        {/* Step 3: Push */}
        {currentStep === 3 && (
          <PushProgressTracker
            progress={pushProgress}
            panelIds={Array.from(selectedPanelIds)}
          />
        )}

        {/* Step 4: Results */}
        {currentStep === 4 && (
          <PushResultSummary
            results={pushResults}
            onRollback={handleRollback}
            onRetry={handleRetry}
          />
        )}
      </CardContent>

      {/* Navigation footer */}
      {currentStep < 4 && (
        <CardFooter className="flex justify-between">
          <div>
            {currentStep === 2 && (
              <Button variant="ghost" onClick={() => setCurrentStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {currentStep === 1 && (
              <Button
                variant="outline"
                disabled={selectedPanelIds.size === 0 || diffLoading}
                onClick={handleNextToDiff}
              >
                {diffLoading ? (
                  <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Next: Preview Changes
              </Button>
            )}
            {currentStep === 2 && (
              <Button onClick={handlePush} disabled={isPushing}>
                Push Configuration
              </Button>
            )}
          </div>
        </CardFooter>
      )}

      {/* Step 4 navigation */}
      {currentStep === 4 && (
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={handleRetry}>
            Push Again
          </Button>
          <a href="/panels" className="text-sm text-muted-foreground hover:text-foreground">
            Back to Panels
          </a>
        </CardFooter>
      )}
    </Card>
  );
}
