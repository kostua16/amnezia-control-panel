'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { TestTube, RefreshCw, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AddServerFormProps {
  onServerAdded: () => void;
  onCancel: () => void;
}

interface FormErrors {
  name?: string;
  hostname?: string;
  port?: string;
  apiKey?: string;
}

function validateHostname(hostname: string): boolean {
  // Allow IP addresses and domain names
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  return ipRegex.test(hostname) || domainRegex.test(hostname);
}

export function AddServerForm({ onServerAdded, onCancel }: AddServerFormProps) {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [apiKey, setApiKey] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = 'Server name is required';
    }
    if (!hostname.trim()) {
      newErrors.hostname = 'Hostname is required';
    } else if (!validateHostname(hostname.trim())) {
      newErrors.hostname = 'Invalid hostname format';
    }
    const portNum = Number(port);
    if (!port || Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      newErrors.port = 'Port must be between 1 and 65535';
    }
    if (!apiKey.trim()) {
      newErrors.apiKey = 'API key is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleTestConnection = async () => {
    if (!validate()) return;

    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          hostname: hostname.trim(),
          port: Number(port),
          apiKey: apiKey.trim(),
        }),
      });
      const json = await res.json();

      if (json.success) {
        // Server was created, now test it
        const testRes = await fetch(`/api/servers/${json.data.id}/test`, {
          method: 'POST',
        });
        const testJson = await testRes.json();
        setTestResult({
          success: testJson.success,
          message: testJson.data?.message ?? 'Test failed',
        });

        if (testJson.success) {
          onServerAdded();
        }
      } else {
        setTestResult({
          success: false,
          message: json.error ?? 'Failed to create server for testing',
        });
      }
    } catch {
      setTestResult({
        success: false,
        message: 'Network error while testing connection',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          hostname: hostname.trim(),
          port: Number(port),
          apiKey: apiKey.trim(),
        }),
      });
      const json = await res.json();

      if (json.success) {
        onServerAdded();
      } else {
        setErrors((prev) => ({
          ...prev,
          hostname:
            json.error?.includes('hostname') ? json.error : prev.hostname,
        }));
      }
    } catch {
      setErrors((prev) => ({
        ...prev,
        hostname: 'Network error',
      }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Server Name */}
      <div className="space-y-1.5">
        <label
          htmlFor="server-name"
          className="text-sm font-medium text-foreground"
        >
          Server Name
        </label>
        <div className="relative">
          <Server className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="server-name"
            type="text"
            placeholder="My VPN Server"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            className={clsx('pl-9', errors.name && 'border-destructive')}
          />
        </div>
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name}</p>
        )}
      </div>

      {/* Hostname */}
      <div className="space-y-1.5">
        <label
          htmlFor="server-hostname"
          className="text-sm font-medium text-foreground"
        >
          Hostname / IP Address
        </label>
        <Input
          id="server-hostname"
          type="text"
          placeholder="192.168.1.1 or vpn.example.com"
          value={hostname}
          onChange={(e) => {
            setHostname(e.target.value);
            setErrors((prev) => ({ ...prev, hostname: undefined }));
          }}
          className={clsx(errors.hostname && 'border-destructive')}
        />
        {errors.hostname && (
          <p className="text-sm text-destructive">{errors.hostname}</p>
        )}
      </div>

      {/* Port */}
      <div className="space-y-1.5">
        <label
          htmlFor="server-port"
          className="text-sm font-medium text-foreground"
        >
          Port
        </label>
        <Input
          id="server-port"
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => {
            setPort(e.target.value);
            setErrors((prev) => ({ ...prev, port: undefined }));
          }}
          className={clsx('w-32', errors.port && 'border-destructive')}
        />
        {errors.port && (
          <p className="text-sm text-destructive">{errors.port}</p>
        )}
      </div>

      {/* API Key */}
      <div className="space-y-1.5">
        <label
          htmlFor="server-apikey"
          className="text-sm font-medium text-foreground"
        >
          API Key
        </label>
        <Input
          id="server-apikey"
          type="password"
          placeholder="Enter server API key"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setErrors((prev) => ({ ...prev, apiKey: undefined }));
          }}
          className={clsx(errors.apiKey && 'border-destructive')}
        />
        {errors.apiKey && (
          <p className="text-sm text-destructive">{errors.apiKey}</p>
        )}
      </div>

      {/* Test Connection Result */}
      {testResult && (
        <div
          className={clsx(
            'rounded-md px-3 py-2 text-sm',
            testResult.success
              ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400',
          )}
        >
          {testResult.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTestConnection}
          disabled={testing}
        >
          {testing ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <TestTube className="mr-2 h-4 w-4" />
          )}
          Test Connection
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add Server'}
          </Button>
        </div>
      </div>
    </form>
  );
}
