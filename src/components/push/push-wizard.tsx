'use client';

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  startTransition,
} from 'react';
import { Check, ArrowLeft, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { PanelSelector } from './panel-selector';
import { ChainTemplateSelector } from './chain-template-selector';
import { ConfigDiffView } from './config-diff-view';
import { PushProgressTracker } from './push-progress-tracker';
import { PushResultSummary } from './push-result-summary';
import { useWebSocket } from '@/hooks/use-websocket';
import {
  buildRoutingOptionsForTopology,
  getInvalidDirectGeoipTags,
  hasDirectGeoipTags,
} from '@/lib/chain-routing-options';
import type { ChainConfig, ChainTemplate } from '@/types/chain';
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
  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<number>>(
    new Set(),
  );
  const [diffResults, setDiffResults] = useState<ConfigDiffResult[]>([]);
  const [pushResults, setPushResults] = useState<PushAllResult | null>(null);
  const [pushProgress, setPushProgress] = useState<
    Map<number, PushProgressEvent>
  >(new Map());
  const [isPushing, setIsPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [templates, setTemplates] = useState<ChainTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] =
    useState<ChainTemplate | null>(null);
  const [panelMapping, setPanelMapping] = useState<Record<number, number>>({});
  const [chainConfigLoading, setChainConfigLoading] = useState(false);
  const [panelApiKeys, setPanelApiKeys] = useState<Record<number, string>>({});
  const [splitDirectGeoipTags, setSplitDirectGeoipTags] = useState('');

  // Track which chain config we're pushing (fetched from apply response or pre-built)
  const chainConfigRef = useRef<ChainConfig | null>(null);

  const handleApiKeyChange = useCallback((panelId: number, apiKey: string) => {
    setPanelApiKeys((prev) => ({ ...prev, [panelId]: apiKey }));
  }, []);

  // Fetch chain templates on mount
  useEffect(() => {
    startTransition(() => {
      fetch('/api/chains/templates')
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setTemplates(json.data);
        })
        .catch(() => {});
    });
  }, []);

  const { isConnected, lastEvent } = useWebSocket({
    autoConnect: true,
    events: ['panel:push-progress'],
  });

  // Handle WebSocket push progress events
  useEffect(() => {
    const progressEvent = lastEvent['panel:push-progress'] as
      PushProgressEvent | undefined;
    if (progressEvent) {
      startTransition(() => {
        setPushProgress((prev) => {
          const next = new Map(prev);
          next.set(progressEvent.panelId, progressEvent);
          return next;
        });
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
      startTransition(() => {
        setIsPushing(false);

        // Only build from WS events if no API result was stored
        if (!pushResults) {
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
        }

        setCurrentStep(4);
      });
    }
  }, [
    currentStep,
    isPushing,
    pushProgress,
    selectedPanelIds,
    panels,
    pushResults,
  ]);

  const handleNextToDiff = useCallback(async () => {
    if (selectedPanelIds.size === 0) return;

    setDiffLoading(true);
    setChainConfigLoading(true);
    setPushError(null);

    try {
      // Guard: should not be reachable when no template is selected (button is disabled)
      if (!selectedTemplate) {
        setPushError('No template selected');
        return;
      }

      // Generate ChainConfig from template + panel mapping
      const configRes = await fetch('/api/panels/push/chain-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          panelMapping,
          routingOptions: buildRoutingOptionsForTopology(
            selectedTemplate.topology,
            splitDirectGeoipTags,
          ),
        }),
      });
      const configJson = await configRes.json();
      if (!configJson.success) {
        setPushError(configJson.error ?? 'Failed to generate chain config');
        setDiffLoading(false);
        setChainConfigLoading(false);
        return;
      }
      chainConfigRef.current = configJson.data;

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
      setPushError(
        err instanceof Error ? err.message : 'Failed to compute diff',
      );
    } finally {
      setDiffLoading(false);
      setChainConfigLoading(false);
    }
  }, [selectedPanelIds, selectedTemplate, panelMapping, splitDirectGeoipTags]);

  const handlePush = useCallback(async () => {
    if (!chainConfigRef.current) return;

    setIsPushing(true);
    setPushError(null);
    setPushProgress(new Map());

    try {
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
        // Store the real PushAllResult from the API response (has accurate configVersion/retries)
        // WebSocket events still drive step 3 progress UI in real-time
        if (json.data) {
          setPushResults(json.data as PushAllResult);
        }
        // Push initiated successfully -- real-time updates via WebSocket
        setCurrentStep(3);
      } else {
        setIsPushing(false);
        setPushError(json.error ?? 'Push failed');
      }
    } catch (err) {
      setIsPushing(false);
      setPushError(err instanceof Error ? err.message : 'Push failed');
    }
  }, [panelApiKeys]);

  const handleRollback = useCallback(
    async (panelId: number) => {
      try {
        const res = await fetch('/api/panels/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            panelId,
            apiKey: panelApiKeys[panelId] ?? '',
          }),
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
        const message = err instanceof Error ? err.message : 'Rollback failed';
        setPushError(`Rollback failed: ${message}`);
      }
    },
    [panelApiKeys],
  );

  const handleRetry = useCallback(() => {
    setPushResults(null);
    setPushProgress(new Map());
    setDiffResults([]);
    setSelectedPanelIds(new Set());
    setSelectedTemplate(null);
    setPanelMapping({});
    setPanelApiKeys({});
    setSplitDirectGeoipTags('');
    setCurrentStep(1);
    setPushError(null);
    chainConfigRef.current = null;
  }, []);

  const splitZonesMissing =
    selectedTemplate?.topology === 'split' &&
    !hasDirectGeoipTags(splitDirectGeoipTags);
  const invalidSplitGeoipTags =
    selectedTemplate?.topology === 'split'
      ? getInvalidDirectGeoipTags(splitDirectGeoipTags)
      : [];

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
          <div className="space-y-6">
            <ChainTemplateSelector
              templates={templates}
              selectedTemplate={selectedTemplate}
              panels={panels}
              panelMapping={panelMapping}
              onTemplateSelect={setSelectedTemplate}
              onPanelMappingChange={setPanelMapping}
            />
            {selectedTemplate?.topology === 'split' && (
              <div className="max-w-sm space-y-1">
                <label
                  htmlFor="push-wizard-split-zones"
                  className="text-sm font-medium text-foreground"
                >
                  Direct GeoIP zones
                </label>
                <Input
                  id="push-wizard-split-zones"
                  value={splitDirectGeoipTags}
                  onChange={(e) => setSplitDirectGeoipTags(e.target.value)}
                  placeholder="ru, kz, de"
                  className={clsx(
                    'text-sm',
                    invalidSplitGeoipTags.length > 0 && 'border-destructive',
                  )}
                />
                {invalidSplitGeoipTags.length > 0 && (
                  <p className="text-xs text-destructive">
                    Invalid GeoIP tag: {invalidSplitGeoipTags[0]}
                  </p>
                )}
              </div>
            )}
            <PanelSelector
              panels={panels}
              selectedPanelIds={selectedPanelIds}
              onSelectionChange={setSelectedPanelIds}
              panelApiKeys={panelApiKeys}
              onApiKeyChange={handleApiKeyChange}
            />
          </div>
        )}

        {/* Step 2: Preview Changes */}
        {currentStep === 2 && (
          <>
            {!isConnected && (
              <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-400">
                Real-time push progress requires WebSocket connection. Push is
                disabled until the connection is restored.
              </div>
            )}
            <ConfigDiffView diffResults={diffResults} />
          </>
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
            progressMap={pushProgress}
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
                disabled={
                  selectedPanelIds.size === 0 ||
                  !selectedTemplate ||
                  Object.keys(panelMapping).length <
                    selectedTemplate.nodes.length ||
                  !Object.values(panelMapping).every((id) =>
                    selectedPanelIds.has(id),
                  ) ||
                  !Array.from(selectedPanelIds).every(
                    (id) => (panelApiKeys[id] ?? '').trim().length > 0,
                  ) ||
                  splitZonesMissing ||
                  diffLoading ||
                  chainConfigLoading
                }
                onClick={handleNextToDiff}
              >
                {diffLoading ? (
                  <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Next: Preview Changes
              </Button>
            )}
            {currentStep === 2 && (
              <Button
                onClick={handlePush}
                disabled={isPushing || !isConnected}
                title={
                  !isConnected
                    ? 'Real-time progress requires WebSocket connection'
                    : undefined
                }
              >
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
          <a
            href="/panels"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Back to Panels
          </a>
        </CardFooter>
      )}
    </Card>
  );
}
