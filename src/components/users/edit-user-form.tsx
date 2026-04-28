'use client';

import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ServiceType } from '@/generated/prisma/enums';

interface FormErrors {
  displayName?: string;
  password?: string;
  confirmPassword?: string;
  trafficQuotaGB?: string;
  speedLimitKbps?: string;
}

export interface EditUserFormData {
  displayName: string | null;
  newPassword?: string;
  trafficQuotaBytes?: number;
  speedLimitKbps?: number;
  services: ServiceType[];
}

interface EditUserFormProps {
  initialData: {
    displayName: string | null;
    trafficQuotaBytes: number;
    speedLimitKbps: number;
    assignedServices: ServiceType[];
  };
  onSubmit: (data: EditUserFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function EditUserForm({
  initialData,
  onSubmit,
  onCancel,
  loading = false,
}: EditUserFormProps) {
  const [displayName, setDisplayName] = useState(initialData.displayName ?? '');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [trafficQuotaGB, setTrafficQuotaGB] = useState(
    initialData.trafficQuotaBytes > 0
      ? String(initialData.trafficQuotaBytes / (1024 * 1024 * 1024))
      : '',
  );
  const [speedLimitKbps, setSpeedLimitKbps] = useState(
    initialData.speedLimitKbps > 0
      ? String(initialData.speedLimitKbps)
      : '',
  );
  const [serviceAWG, setServiceAWG] = useState(
    initialData.assignedServices.includes(ServiceType.AWG),
  );
  const [service3xUI, setService3xUI] = useState(
    initialData.assignedServices.includes(ServiceType.THREE_XUI),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (passwordOpen) {
      if (password && password.length < 3) {
        newErrors.password = 'Password must be at least 3 characters';
      }
      if (password && password !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
      if (!password && confirmPassword) {
        newErrors.password = 'Enter a password to confirm';
      }
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
  }, [password, confirmPassword, passwordOpen, trafficQuotaGB, speedLimitKbps]);

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordOpen) {
      setTouched((prev) => ({
        ...prev,
        password: true,
        confirmPassword: true,
      }));
    }

    if (!validate()) return;

    const data: EditUserFormData = {
      displayName: displayName.trim() || null,
      services: [],
    };

    if (password) {
      data.newPassword = password;
    }

    if (trafficQuotaGB) {
      data.trafficQuotaBytes = Number(trafficQuotaGB) * 1024 * 1024 * 1024;
    }

    if (speedLimitKbps) {
      data.speedLimitKbps = Number(speedLimitKbps);
    }

    const services: ServiceType[] = [];
    if (serviceAWG) services.push(ServiceType.AWG);
    if (service3xUI) services.push(ServiceType.THREE_XUI);
    data.services = services;

    onSubmit(data);
  };

  const showError = (field: string, error?: string) => {
    return touched[field] && error;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Display Name */}
      <div className="space-y-1">
        <label
          htmlFor="edit-displayname"
          className="block text-sm font-medium text-foreground"
        >
          Display Name
        </label>
        <Input
          id="edit-displayname"
          type="text"
          placeholder="Optional display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={loading}
        />
      </div>

      {/* Password Change (collapsed by default) */}
      <div className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => setPasswordOpen(!passwordOpen)}
          className={clsx(
            'flex w-full items-center justify-between px-3 py-2 text-sm font-medium',
            'text-muted-foreground hover:text-foreground transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md',
          )}
        >
          Change Password
          {passwordOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {passwordOpen && (
          <div className="space-y-4 border-t border-border px-3 py-3">
            <div className="space-y-1">
              <label
                htmlFor="edit-password"
                className="block text-sm text-foreground"
              >
                New Password
              </label>
              <Input
                id="edit-password"
                type="password"
                placeholder="Leave blank to keep current"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur('password')}
                disabled={loading}
                className={clsx(
                  showError('password', errors.password) &&
                    'border-destructive',
                )}
              />
              {showError('password', errors.password) && (
                <p className="text-xs text-destructive">{errors.password}</p>
              )}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="edit-confirm-password"
                className="block text-sm text-foreground"
              >
                Confirm Password
              </label>
              <Input
                id="edit-confirm-password"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => handleBlur('confirmPassword')}
                disabled={loading}
                className={clsx(
                  showError('confirmPassword', errors.confirmPassword) &&
                    'border-destructive',
                )}
              />
              {showError('confirmPassword', errors.confirmPassword) && (
                <p className="text-xs text-destructive">
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          </div>
        )}
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
                htmlFor="edit-quota"
                className="block text-sm text-foreground"
              >
                Traffic Quota (GB)
              </label>
              <Input
                id="edit-quota"
                type="number"
                placeholder="Unlimited"
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
                htmlFor="edit-speed"
                className="block text-sm text-foreground"
              >
                Speed Limit (Kbps)
              </label>
              <Input
                id="edit-speed"
                type="number"
                placeholder="Unlimited"
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
          Save Changes
        </Button>
      </div>
    </form>
  );
}
