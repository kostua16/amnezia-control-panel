'use client';

import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RuleAction, RuleProtocol } from '@/types/routing';
import type { UserListItem } from '@/types/user';

interface InitialRuleData {
  protocol: RuleProtocol;
  destination: string;
  action: RuleAction;
  priority: number;
  isActive: boolean;
  userId: number | null;
}

interface CreateRoutingRuleFormProps {
  users: UserListItem[];
  initialData?: InitialRuleData;
  onSubmit: (data: {
    protocol: RuleProtocol;
    destination: string;
    action: RuleAction;
    priority: number;
    isActive: boolean;
    userId: number | null;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
}

const protocolOptions: { value: RuleProtocol; label: string }[] = [
  { value: 'ANY', label: 'Any Protocol' },
  { value: 'WIREGUARD', label: 'WireGuard' },
  { value: 'VLESS', label: 'VLESS' },
  { value: 'VMESS', label: 'VMess' },
  { value: 'TROJAN', label: 'Trojan' },
  { value: 'SHADOWSOCKS', label: 'Shadowsocks' },
];

const actionOptions: { value: RuleAction; label: string }[] = [
  { value: 'ALLOW', label: 'Allow' },
  { value: 'BLOCK', label: 'Block' },
  { value: 'ROUTE', label: 'Route' },
];

interface FormErrors {
  destination?: string;
}

export function CreateRoutingRuleForm({
  users,
  initialData,
  onSubmit,
  onCancel,
  loading = false,
}: CreateRoutingRuleFormProps) {
  const [protocol, setProtocol] = useState<RuleProtocol>(initialData?.protocol ?? 'ANY');
  const [destination, setDestination] = useState(initialData?.destination ?? '');
  const [action, setAction] = useState<RuleAction>(initialData?.action ?? 'ALLOW');
  const [priority, setPriority] = useState(String(initialData?.priority ?? 0));
  const [isActive, setIsActive] = useState(initialData?.isActive ?? true);
  const [userId, setUserId] = useState<string>(initialData?.userId ? String(initialData.userId) : '');
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!destination.trim()) {
      newErrors.destination = 'Destination is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [destination]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ destination: true });

    if (!validate()) return;

    onSubmit({
      protocol,
      destination: destination.trim(),
      action,
      priority: parseInt(priority, 10) || 0,
      isActive,
      userId: userId ? parseInt(userId, 10) : null,
    });
  };

  const showError = (field: string, error?: string) => {
    return touched[field] && error;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Protocol */}
      <div className="space-y-1">
        <label
          htmlFor="rule-protocol"
          className="block text-sm font-medium text-foreground"
        >
          Protocol
        </label>
        <select
          id="rule-protocol"
          value={protocol}
          onChange={(e) => setProtocol(e.target.value as RuleProtocol)}
          disabled={loading}
          className={clsx(
            'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2',
            'text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {protocolOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Destination */}
      <div className="space-y-1">
        <label
          htmlFor="rule-destination"
          className="block text-sm font-medium text-foreground"
        >
          Destination
        </label>
        <Input
          id="rule-destination"
          type="text"
          placeholder="IP, CIDR, or domain pattern (e.g., 10.0.0.0/8, *.example.com)"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, destination: true }))}
          disabled={loading}
          className={clsx(
            showError('destination', errors.destination) && 'border-destructive',
          )}
        />
        {showError('destination', errors.destination) && (
          <p className="text-xs text-destructive">{errors.destination}</p>
        )}
      </div>

      {/* Action */}
      <div className="space-y-1">
        <span className="block text-sm font-medium text-foreground">Action</span>
        <div className="flex gap-3">
          {actionOptions.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="rule-action"
                value={opt.value}
                checked={action === opt.value}
                onChange={(e) => setAction(e.target.value as RuleAction)}
                disabled={loading}
                className="accent-accent"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* User (optional) */}
      <div className="space-y-1">
        <label
          htmlFor="rule-user"
          className="block text-sm font-medium text-foreground"
        >
          User (optional)
        </label>
        <select
          id="rule-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          disabled={loading}
          className={clsx(
            'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2',
            'text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <option value="">All Users (Global)</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName ?? user.username}
              {user.displayName ? ` (@${user.username})` : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Leave empty to apply this rule to all users globally.
        </p>
      </div>

      {/* Priority */}
      <div className="space-y-1">
        <label
          htmlFor="rule-priority"
          className="block text-sm font-medium text-foreground"
        >
          Priority
        </label>
        <Input
          id="rule-priority"
          type="number"
          min={0}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          disabled={loading}
        />
        <p className="text-xs text-muted-foreground">
          Lower values are evaluated first (higher priority).
        </p>
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="rule-active"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          disabled={loading}
          className="h-4 w-4 rounded border-border accent-accent"
        />
        <label htmlFor="rule-active" className="text-sm text-foreground">
          Rule is active
        </label>
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
          Create Rule
        </Button>
      </div>
    </form>
  );
}
