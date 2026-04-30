'use client';

import { CheckCircle, XCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ErrorRecommendation } from './error-recommendation';
import type { PushAllResult } from '@/types/panel-sync';
import type { StructuredPushError } from '@/types/config-push';

interface PushResultSummaryProps {
  results: PushAllResult | null;
  onRollback: (panelId: number) => void;
  onRetry: () => void;
}

export function PushResultSummary({
  results,
  onRollback,
  onRetry,
}: PushResultSummaryProps) {
  if (!results) return null;

  const hasFailures = results.failed > 0;
  const allSuccess = results.failed === 0;

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
          {results.results.map((result) => (
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
                    </p>
                  ) : (
                    <p className="text-xs text-destructive">{result.error}</p>
                  )}
                </div>
                {!result.success && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    onClick={() => onRollback(result.panelId)}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Rollback
                  </Button>
                )}
              </div>

              {/* Error recommendation for failed panels with structured errors */}
              {!result.success && result.error && (
                <div className="mt-2 ml-8">
                  <ErrorRecommendation
                    error={{
                      type: 'unknown',
                      message: result.error,
                      recommendation: 'Check the panel connection and try again.',
                      knownFix: null,
                      rawError: null,
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
