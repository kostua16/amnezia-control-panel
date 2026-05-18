'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { FileText } from 'lucide-react';
import type { ConfigDiffResult } from '@/types/config-push';

interface ConfigDiffViewProps {
  diffResults: ConfigDiffResult[];
}

export function ConfigDiffView({ diffResults }: ConfigDiffViewProps) {
  const [activePanelId, setActivePanelId] = useState<number | null>(
    diffResults.length > 0 ? diffResults[0].panelId : null,
  );

  if (diffResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No changes to preview</p>
      </div>
    );
  }

  const activeDiff = diffResults.find((d) => d.panelId === activePanelId);

  return (
    <div className="space-y-4">
      {/* Panel tabs */}
      <div className="flex gap-2 overflow-x-auto">
        {diffResults.map((diff) => (
          <button
            key={diff.panelId}
            onClick={() => setActivePanelId(diff.panelId)}
            className={clsx(
              'px-4 py-2 rounded-md text-sm whitespace-nowrap transition-colors',
              activePanelId === diff.panelId
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {diff.panelName}
            {!diff.hasChanges && ' (no changes)'}
          </button>
        ))}
      </div>

      {/* Diff content for active panel */}
      {activeDiff && (
        <div>
          <h3 className="text-lg font-bold mb-4">
            Configuration Preview -- {activeDiff.panelName}
          </h3>

          {!activeDiff.hasChanges ? (
            <p className="text-sm text-muted-foreground py-4">
              No changes for this panel
            </p>
          ) : (
            <div className="space-y-4">
              {/* Sections with diff lines */}
              {activeDiff.sections.map((section) => (
                <div key={section.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-sm">{section.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">
                      +{section.summary.added}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                      -{section.summary.removed}
                    </span>
                  </div>
                  <div className="rounded-md border border-border bg-background overflow-auto max-h-64">
                    <pre className="p-3 font-mono text-xs">
                      {section.lines.map((line, i) => (
                        <div
                          key={i}
                          className={clsx(
                            line.type === 'added' &&
                              'bg-green-500/10 text-green-400',
                            line.type === 'removed' &&
                              'bg-red-500/10 text-red-400',
                          )}
                        >
                          <code>
                            {line.type === 'added'
                              ? '+'
                              : line.type === 'removed'
                                ? '-'
                                : ' '}{' '}
                            {line.content}
                          </code>
                        </div>
                      ))}
                    </pre>
                  </div>
                </div>
              ))}

              {/* Side-by-side formatted configs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">
                    Current Configuration
                  </h4>
                  <div className="rounded-md border border-border bg-background overflow-auto max-h-64">
                    <pre className="p-3 font-mono text-xs">
                      <code>
                        {activeDiff.currentConfigFormatted
                          ? activeDiff.currentConfigFormatted
                          : 'No current config'}
                      </code>
                    </pre>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2">
                    New Configuration
                  </h4>
                  <div className="rounded-md border border-border bg-background overflow-auto max-h-64">
                    <pre className="p-3 font-mono text-xs">
                      <code>{activeDiff.newConfigFormatted}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
