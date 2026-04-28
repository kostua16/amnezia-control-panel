'use client';

import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type QuotaPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

interface QuotaData {
  id: number;
  userId: number;
  quotaBytes: number;
  period: QuotaPeriod;
  resetAt: string | null;
}

interface UserQuotaFormProps {
  userId: number;
  initialData?: QuotaData | null;
  onSubmit: (data: { quotaBytes: number; period: QuotaPeriod }) => void;
  onCancel: () => void;
  loading?: boolean;
}

const periodOptions: { value: QuotaPeriod; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 GB';
  const gb = bytes / (1024 * 1024 * 1024);
  return gb.toFixed(2) + ' GB';
}

function formatResetDate(iso: string | null): string {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UserQuotaForm({
  initialData,
  onSubmit,
  onCancel,
  loading = false,
}: UserQuotaFormProps) {
  const [quotaGB, setQuotaGB] = useState(
    initialData && initialData.quotaBytes > 0
      ? String(initialData.quotaBytes / (1024 * 1024 * 1024))
      : '',
  );
  const [period, setPeriod] = useState<QuotaPeriod>(
    initialData?.period ?? 'MONTHLY',
  );
  const [errors, setErrors] = useState<{ quotaGB?: string }>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = useCallback((): boolean => {
    const newErrors: { quotaGB?: string } = {};

    if (quotaGB !== '' && (isNaN(Number(quotaGB)) || Number(quotaGB) < 0)) {
      newErrors.quotaGB = 'Must be a positive number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [quotaGB]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ quotaGB: true });

    if (!validate()) return;

    const quotaBytes =
      quotaGB === '' ? 0 : Math.floor(Number(quotaGB) * 1024 * 1024 * 1024);

    onSubmit({ quotaBytes, period });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Current usage display */}
      {initialData && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current quota:</span>
            <span className="font-medium">
              {initialData.quotaBytes > 0
                ? formatBytes(initialData.quotaBytes)
                : 'Unlimited'}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-muted-foreground">Current period:</span>
            <span className="font-medium">{initialData.period}</span>
          </div>
          {initialData.resetAt && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-muted-foreground">Resets at:</span>
              <span className="font-medium">
                {formatResetDate(initialData.resetAt)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Quota input (GB) */}
      <div className="space-y-1">
        <label
          htmlFor="quota-gb"
          className="block text-sm font-medium text-foreground"
        >
          Traffic Quota (GB)
        </label>
        <Input
          id="quota-gb"
          type="number"
          placeholder="Leave empty for unlimited"
          min={0}
          step="0.1"
          value={quotaGB}
          onChange={(e) => setQuotaGB(e.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, quotaGB: true }))}
          disabled={loading}
          className={clsx(
            touched.quotaGB && errors.quotaGB && 'border-destructive',
          )}
        />
        <p className="text-xs text-muted-foreground">
          Set to 0 or leave empty for unlimited traffic.
        </p>
        {touched.quotaGB && errors.quotaGB && (
          <p className="text-xs text-destructive">{errors.quotaGB}</p>
        )}
      </div>

      {/* Period dropdown */}
      <div className="space-y-1">
        <label
          htmlFor="quota-period"
          className="block text-sm font-medium text-foreground"
        >
          Reset Period
        </label>
        <select
          id="quota-period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as QuotaPeriod)}
          disabled={loading}
          className={clsx(
            'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2',
            'text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {periodOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Traffic counter will reset at the end of each period.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Quota
        </Button>
      </div>
    </form>
  );
}
