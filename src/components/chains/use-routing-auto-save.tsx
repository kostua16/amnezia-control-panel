'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Check } from 'lucide-react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface AutoSaveRequest {
  url: string;
  method: string;
}

interface UseRoutingAutoSaveOptions {
  /** Resolve the endpoint for a create (no id) or update (with id) request. */
  resolveRequest: (id?: number) => AutoSaveRequest;
  /** Called after a successful save (typically a refetch). */
  onSuccess: () => void;
  /** Called with a human-readable message when the save fails. */
  onError: (message: string) => void;
  /** Debounce delay in ms. */
  delay?: number;
}

/**
 * Debounced auto-save for routing rule edits. Fires a PUT (edit) or POST
 * (create) after the form is quiet for `delay` ms, surfacing save status
 * so the UI can show a saving/saved/error indicator.
 *
 * The latest options are kept in a ref so callers can pass inline callbacks
 * without rebuilding the `save` function each render.
 */
export function useRoutingAutoSave<TBody>(options: UseRoutingAutoSaveOptions) {
  // Keep the latest options in a ref so callers can pass inline callbacks
  // without rebuilding `save`. Updated in an effect, not during render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>('idle');

  const save = useCallback((data: TBody, id?: number) => {
    const opts = optionsRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);

    setStatus('saving');

    timerRef.current = setTimeout(async () => {
      try {
        const { url, method } = opts.resolveRequest(id);
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const result = await response.json();
          opts.onError(result.error || 'Failed to save rule');
          setStatus('error');
          return;
        }
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1000);
        opts.onSuccess();
      } catch {
        opts.onError('Network error.');
        setStatus('error');
      }
    }, opts.delay ?? 500);
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus('idle');
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { status, save, cancel };
}

export function AutoSaveIndicator({ status }: { status: AutoSaveStatus }) {
  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-500">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        Error
      </span>
    );
  }
  return null;
}
