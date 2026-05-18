'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { TestTube, RefreshCw, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AddPanelFormProps {
  onPanelAdded: () => void;
  onCancel: () => void;
}

interface FormErrors {
  name?: string;
  panelUrl?: string;
  apiKey?: string;
}

function validateUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function AddPanelForm({ onPanelAdded, onCancel }: AddPanelFormProps) {
  const [name, setName] = useState('');
  const [panelUrl, setPanelUrl] = useState('');
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
      newErrors.name = 'Panel name is required';
    }
    if (!panelUrl.trim()) {
      newErrors.panelUrl = 'Panel URL is required';
    } else if (!validateUrl(panelUrl.trim())) {
      newErrors.panelUrl = 'Invalid URL format';
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
      const res = await fetch('/api/panels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          panelUrl: panelUrl.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      const json = await res.json();

      if (json.success) {
        // Panel was created, now test it
        const testRes = await fetch(`/api/panels/${json.data.id}/test`, {
          method: 'POST',
        });
        const testJson = await testRes.json();
        setTestResult({
          success: testJson.success,
          message: testJson.data?.message ?? 'Test failed',
        });

        if (testJson.success) {
          onPanelAdded();
        }
      } else {
        setTestResult({
          success: false,
          message: json.error ?? 'Failed to create panel for testing',
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
      const res = await fetch('/api/panels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          panelUrl: panelUrl.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      const json = await res.json();

      if (json.success) {
        onPanelAdded();
      } else {
        setErrors((prev) => ({
          ...prev,
          panelUrl: json.error?.includes('panelUrl')
            ? json.error
            : prev.panelUrl,
        }));
      }
    } catch {
      setErrors((prev) => ({
        ...prev,
        panelUrl: 'Network error',
      }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Panel Name */}
      <div className="space-y-1.5">
        <label
          htmlFor="panel-name"
          className="text-sm font-medium text-foreground"
        >
          Panel Name
        </label>
        <div className="relative">
          <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="panel-name"
            type="text"
            placeholder="EU West Panel"
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

      {/* Panel URL */}
      <div className="space-y-1.5">
        <label
          htmlFor="panel-url"
          className="text-sm font-medium text-foreground"
        >
          Panel URL
        </label>
        <Input
          id="panel-url"
          type="text"
          placeholder="http://100.x.x.x:3333"
          value={panelUrl}
          onChange={(e) => {
            setPanelUrl(e.target.value);
            setErrors((prev) => ({ ...prev, panelUrl: undefined }));
          }}
          className={clsx(errors.panelUrl && 'border-destructive')}
        />
        {errors.panelUrl && (
          <p className="text-sm text-destructive">{errors.panelUrl}</p>
        )}
      </div>

      {/* API Key */}
      <div className="space-y-1.5">
        <label
          htmlFor="panel-apikey"
          className="text-sm font-medium text-foreground"
        >
          API Key
        </label>
        <Input
          id="panel-apikey"
          type="password"
          placeholder="Enter panel API key"
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
            Discard
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add Panel'}
          </Button>
        </div>
      </div>
    </form>
  );
}
