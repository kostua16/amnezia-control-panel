'use client';

import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CreateUserPayload } from '@/types/user';
import { ServiceType } from '@/generated/prisma/enums';

interface FormErrors {
  username?: string;
  password?: string;
  displayName?: string;
  trafficQuotaGB?: string;
  speedLimitKbps?: string;
}

interface CreateUserFormProps {
  onSubmit: (data: CreateUserPayload) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function CreateUserForm({
  onSubmit,
  onCancel,
  loading = false,
}: CreateUserFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [trafficQuotaGB, setTrafficQuotaGB] = useState('');
  const [speedLimitKbps, setSpeedLimitKbps] = useState('');
  const [serviceAWG, setServiceAWG] = useState(true);
  const [service3xUI, setService3xUI] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!username.trim()) {
      newErrors.username = 'Username is required';
    } else if (username.trim().length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 3) {
      newErrors.password = 'Password must be at least 3 characters';
    }

    if (trafficQuotaGB && isNaN(Number(trafficQuotaGB))) {
      newErrors.trafficQuotaGB = 'Must be a valid number';
    } else if (trafficQuotaGB && Number(trafficQuotaGB) < 0) {
      newErrors.trafficQuotaGB = 'Must be a positive number';
    }

    if (speedLimitKbps && isNaN(Number(speedLimitKbps))) {
      newErrors.speedLimitKbps = 'Must be a valid number';
    } else if (speedLimitKbps && Number(speedLimitKbps) < 0) {
      newErrors.speedLimitKbps = 'Must be a positive number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [username, password, trafficQuotaGB, speedLimitKbps]);

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all required fields as touched
    setTouched({ username: true, password: true });

    if (!validate()) return;

    const payload: CreateUserPayload = {
      username: username.trim(),
      password,
    };

    if (displayName.trim()) {
      payload.displayName = displayName.trim();
    }

    if (trafficQuotaGB) {
      payload.trafficQuotaBytes = Number(trafficQuotaGB) * 1024 * 1024 * 1024;
    }

    if (speedLimitKbps) {
      payload.speedLimitKbps = Number(speedLimitKbps);
    }

    const services: ServiceType[] = [];
    if (serviceAWG) services.push(ServiceType.AWG);
    if (service3xUI) services.push(ServiceType.THREE_XUI);
    if (services.length > 0) {
      payload.services = services;
    }

    onSubmit(payload);
  };

  const showError = (field: string, error?: string) => {
    return touched[field] && error;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Username */}
      <div className="space-y-1">
        <label
          htmlFor="create-username"
          className="block text-sm font-medium text-foreground"
        >
          Username <span className="text-destructive">*</span>
        </label>
        <Input
          id="create-username"
          type="text"
          placeholder="Enter username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => handleBlur('username')}
          disabled={loading}
          className={clsx(
            showError('username', errors.username) && 'border-destructive',
          )}
        />
        {showError('username', errors.username) && (
          <p className="text-xs text-destructive">{errors.username}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1">
        <label
          htmlFor="create-password"
          className="block text-sm font-medium text-foreground"
        >
          Password <span className="text-destructive">*</span>
        </label>
        <Input
          id="create-password"
          type="password"
          placeholder="Enter password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => handleBlur('password')}
          disabled={loading}
          className={clsx(
            showError('password', errors.password) && 'border-destructive',
          )}
        />
        {showError('password', errors.password) && (
          <p className="text-xs text-destructive">{errors.password}</p>
        )}
      </div>

      {/* Display Name */}
      <div className="space-y-1">
        <label
          htmlFor="create-displayname"
          className="block text-sm font-medium text-foreground"
        >
          Display Name
        </label>
        <Input
          id="create-displayname"
          type="text"
          placeholder="Optional display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={loading}
        />
      </div>

      {/* Service checkboxes */}
      <div className="space-y-2">
        <span className="block text-sm font-medium text-foreground">
          Services
        </span>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={serviceAWG}
              onChange={(e) => setServiceAWG(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            AWG
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={service3xUI}
              onChange={(e) => setService3xUI(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            3x-ui
          </label>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className={clsx(
            'flex w-full items-center justify-between px-3 py-2 text-sm font-medium',
            'text-muted-foreground hover:text-foreground transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md',
          )}
        >
          Advanced Settings
          {advancedOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {advancedOpen && (
          <div className="space-y-4 border-t border-border px-3 py-3">
            {/* Traffic Quota */}
            <div className="space-y-1">
              <label
                htmlFor="create-quota"
                className="block text-sm text-foreground"
              >
                Traffic Quota (GB)
              </label>
              <Input
                id="create-quota"
                type="number"
                placeholder="e.g. 100"
                min={0}
                value={trafficQuotaGB}
                onChange={(e) => setTrafficQuotaGB(e.target.value)}
                onBlur={() => handleBlur('trafficQuotaGB')}
                disabled={loading}
                className={clsx(
                  showError('trafficQuotaGB', errors.trafficQuotaGB) &&
                    'border-destructive',
                )}
              />
              {showError('trafficQuotaGB', errors.trafficQuotaGB) && (
                <p className="text-xs text-destructive">
                  {errors.trafficQuotaGB}
                </p>
              )}
            </div>

            {/* Speed Limit */}
            <div className="space-y-1">
              <label
                htmlFor="create-speed"
                className="block text-sm text-foreground"
              >
                Speed Limit (Kbps)
              </label>
              <Input
                id="create-speed"
                type="number"
                placeholder="e.g. 10240"
                min={0}
                value={speedLimitKbps}
                onChange={(e) => setSpeedLimitKbps(e.target.value)}
                onBlur={() => handleBlur('speedLimitKbps')}
                disabled={loading}
                className={clsx(
                  showError('speedLimitKbps', errors.speedLimitKbps) &&
                    'border-destructive',
                )}
              />
              {showError('speedLimitKbps', errors.speedLimitKbps) && (
                <p className="text-xs text-destructive">
                  {errors.speedLimitKbps}
                </p>
              )}
            </div>
          </div>
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
          Create User
        </Button>
      </div>
    </form>
  );
}
