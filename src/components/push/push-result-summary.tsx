'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, RotateCcw, AlertTriangle, Undo2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ErrorRecommendation } from './error-recommendation';
import type { PushAllResult, PushResult } from '@/types/panel-sync';
import type { StructuredPushError, PushProgressEvent } from '@/types/config-push';

interface PushResultSummaryProps {
  results: PushAllResult | null;
  progressMap?: Map<number, PushProgressEvent>;
  onRollback: (panelId: number) => void;
  onRetry: () => void;
}

export function PushResultSummary({
  results,
  progressMap,
  onRollback,
  onRetry,
}: PushResultSummaryProps) {
  const [rolledBackPanels, setRolledBackPanels] = useState<Set<number>>(new Set());

  if (!results) return null;

  const hasFailures = results.failed > 0;
  const allSuccess = results.failed === 0;

  // Track which error index is the first (for defaultExpanded)
  let firstErrorIndex = 0;

  const getStructuredError = (result: PushResult): StructuredPushError | null => {
    // Check if we have a structured error from WebSocket progress events
    const progressEvent = progressMap?.get(result.panelId);
    if (progressEvent?.error) {
      return progressEvent.error;
    }
    // Fall back to a generic structured error from the result's error string
    if (result.error) {
      return {
        type: 'unknown',
        message: result.error,
        recommendation: 'Check the panel connection and try again.',
        knownFix: null,
        rawError: null,
      };
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div
        className={clsx(
          'rounded-md border p-4',
          allSuccess && 'border-green-500/30 bg-green-500/5',
          hasFailures && 'border-brand-warning/30 bg-brand-warning/5',
        )}
      >
        <div className="flex items-center gap-2">
          {allSuccess ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-brand-warning" />
          )}
          <p className="text-sm font-medium">
            {results.succeeded} of {results.totalPanels} panels updated
          </p>
        </div>
        {hasFailures && (
          <p className="text-sm text-muted-foreground mt-1">
            {results.succeeded} of {results.totalPanels} panels updated successfully. Review failed panels below.
          </p>
        )}
      </div>

      {/* Per-panel results */}
      <Card>
        <CardHeader>
          <CardTitle>Panel Results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {results.results.map((result) => {
            const structuredError = getStructuredError(result);
            const isError = !result.success;
            const isFirstError = isError;
            const errorIndex = isFirstError ? firstErrorIndex++ : -1;

            return (
              <div key={result.panelId}>
                <div className="flex items-center gap-3 rounded-md border border-border p-3">
                  {result.success ? (
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{result.panelName}</p>
                    {result.success ? (
                      <p className="text-xs text-muted-foreground">
                        Configuration applied to {result.panelName}
                        {result.latencyMs != null ? ` (${result.latencyMs}ms)` : ''}
                        {result.configVersion != null ? ` · v${result.configVersion}` : ''}
                        {result.retries > 0 ? ` · ${result.retries} ${result.retries === 1 ? 'retry' : 'retries'}` : ''}
                      </p>
                    ) : structuredError ? (
                      <p className="text-xs text-destructive">
                        Push failed on {result.panelName}: {structuredError.message}. {structuredError.recommendation}
                      </p>
                    ) : result.error ? (
                      <p className="text-xs text-destructive">{result.error}</p>
                    ) : null}
                  </div>
                  {!result.success && !rolledBackPanels.has(result.panelId) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      onClick={() => {
                        onRollback(result.panelId);
                        setRolledBackPanels((prev) => new Set(prev).add(result.panelId));
                      }}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Rollback
                    </Button>
                  )}
                </div>

                {/* Error recommendation for failed panels */}
                {!result.success && structuredError && (
                  <div className="mt-2 ml-8">
                    <ErrorRecommendation
                      error={structuredError}
                      panelName={result.panelName}
                      defaultExpanded={errorIndex === 0}
                    />
                  </div>
                )}

                {/* Rollback success message */}
                {!result.success && rolledBackPanels.has(result.panelId) && (
                  <p className="mt-2 ml-8 text-xs text-green-500 flex items-center gap-1">
                    <Undo2 className="h-3 w-3" />
                    Rolled back to previous configuration on {result.panelName}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
