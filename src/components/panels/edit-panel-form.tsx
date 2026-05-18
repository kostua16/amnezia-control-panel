'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EditPanelFormProps {
  panel: { id: number; name: string; panelUrl: string };
  onPanelUpdated: () => void;
  onCancel: () => void;
}

interface FormErrors {
  name?: string;
  panelUrl?: string;
}

function validateUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function EditPanelForm({
  panel,
  onPanelUpdated,
  onCancel,
}: EditPanelFormProps) {
  const [name, setName] = useState(panel.name);
  const [panelUrl, setPanelUrl] = useState(panel.panelUrl);
  const [apiKey, setApiKey] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        name: name.trim(),
        panelUrl: panelUrl.trim(),
      };

      // Only include apiKey if it was changed (non-empty)
      if (apiKey.trim()) {
        body.apiKey = apiKey.trim();
      }

      const res = await fetch(`/api/panels/${panel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.success) {
        onPanelUpdated();
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
          htmlFor="edit-panel-name"
          className="text-sm font-medium text-foreground"
        >
          Panel Name
        </label>
        <div className="relative">
          <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="edit-panel-name"
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
          htmlFor="edit-panel-url"
          className="text-sm font-medium text-foreground"
        >
          Panel URL
        </label>
        <Input
          id="edit-panel-url"
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

      {/* API Key (optional - leave empty to keep existing) */}
      <div className="space-y-1.5">
        <label
          htmlFor="edit-panel-apikey"
          className="text-sm font-medium text-foreground"
        >
          API Key
        </label>
        <Input
          id="edit-panel-apikey"
          type="password"
          placeholder="Enter panel API key"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to keep the existing API key.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Discard
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}
