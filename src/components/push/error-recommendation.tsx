'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import type { StructuredPushError } from '@/types/config-push';

interface ErrorRecommendationProps {
  error: StructuredPushError;
  defaultExpanded?: boolean;
}

const ERROR_TYPE_COLORS: Record<StructuredPushError['type'], string> = {
  connection_timeout: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  auth_failure: 'bg-red-500/10 text-red-400 border-red-500/20',
  invalid_config: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  service_error: 'bg-red-500/10 text-red-400 border-red-500/20',
  docker_error: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  unknown: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export function ErrorRecommendation({
  error,
  defaultExpanded = false,
}: ErrorRecommendationProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left p-3 hover:bg-muted/50 rounded-md transition-colors"
      >
        <span
          className={clsx(
            'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border',
            ERROR_TYPE_COLORS[error.type],
          )}
        >
          {error.type.replace(/_/g, ' ')}
        </span>
        <span className="text-sm font-medium flex-1">{error.message}</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Recommended action:</span>{' '}
            {error.recommendation}
          </p>
          {error.knownFix && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                <span className="font-medium text-foreground">Known fix:</span>
              </p>
              <pre className="rounded-md bg-background border border-border p-2 font-mono text-xs overflow-x-auto">
                <code>{error.knownFix}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
