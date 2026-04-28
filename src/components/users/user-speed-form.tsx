'use client';

import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface UserSpeedFormProps {
  initialSpeedKbps: number;
  onSubmit: (data: { speedLimitKbps: number }) => void;
  onCancel: () => void;
  loading?: boolean;
}

const speedPresets: { label: string; kbps: number }[] = [
  { label: '1 Mbps', kbps: 1000 },
  { label: '5 Mbps', kbps: 5000 },
  { label: '10 Mbps', kbps: 10000 },
  { label: '50 Mbps', kbps: 50000 },
  { label: 'Unlimited', kbps: 0 },
];

function formatSpeed(kbps: number): string {
  if (kbps === 0) return 'Unlimited';
  if (kbps >= 1000) {
    return `${kbps / 1000} Mbps`;
  }
  return `${kbps} Kbps`;
}

export function UserSpeedForm({
  initialSpeedKbps,
  onSubmit,
  onCancel,
  loading = false,
}: UserSpeedFormProps) {
  const [speedKbps, setSpeedKbps] = useState(
    initialSpeedKbps > 0 ? String(initialSpeedKbps) : '',
  );
  const [errors, setErrors] = useState<{ speedKbps?: string }>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = useCallback((): boolean => {
    const newErrors: { speedKbps?: string } = {};

    if (speedKbps !== '' && (isNaN(Number(speedKbps)) || Number(speedKbps) < 0)) {
      newErrors.speedKbps = 'Must be a positive number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [speedKbps]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ speedKbps: true });

    if (!validate()) return;

    const speedLimitKbps = speedKbps === '' ? 0 : Math.floor(Number(speedKbps));
    onSubmit({ speedLimitKbps });
  };

  const applyPreset = (kbps: number) => {
    setSpeedKbps(kbps > 0 ? String(kbps) : '');
    setTouched({ speedKbps: false });
    setErrors({});
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Current speed display */}
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Current limit:</span>
          <span className="font-medium">
            {formatSpeed(initialSpeedKbps)}
          </span>
        </div>
      </div>

      {/* Preset buttons */}
      <div className="space-y-1">
        <span className="block text-sm font-medium text-foreground">
          Quick Presets
        </span>
        <div className="flex flex-wrap gap-2">
          {speedPresets.map((preset) => (
            <button
              key={preset.kbps}
              type="button"
              onClick={() => applyPreset(preset.kbps)}
              disabled={loading}
              className={clsx(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-50',
                speedKbps === String(preset.kbps) || (preset.kbps === 0 && speedKbps === '')
                  ? 'border-accent bg-accent/10 text-accent-foreground'
                  : 'border-border text-foreground',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom speed input */}
      <div className="space-y-1">
        <label
          htmlFor="speed-kbps"
          className="block text-sm font-medium text-foreground"
        >
          Custom Speed Limit (Kbps)
        </label>
        <Input
          id="speed-kbps"
          type="number"
          placeholder="0 for unlimited"
          min={0}
          value={speedKbps}
          onChange={(e) => setSpeedKbps(e.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, speedKbps: true }))}
          disabled={loading}
          className={clsx(
            touched.speedKbps && errors.speedKbps && 'border-destructive',
          )}
        />
        <p className="text-xs text-muted-foreground">
          Set to 0 or leave empty for unlimited speed.
        </p>
        {touched.speedKbps && errors.speedKbps && (
          <p className="text-xs text-destructive">{errors.speedKbps}</p>
        )}
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
          Save Speed Limit
        </Button>
      </div>
    </form>
  );
}
