'use client';

import { useState, useEffect, startTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

interface SaveTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  initialValues?: { name: string; description: string };
  onSaved?: () => void;
}

export function SaveTemplateDialog({
  open,
  onClose,
  initialValues,
  onSaved,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        if (initialValues) {
          setName(initialValues.name);
          setDescription(initialValues.description);
        } else {
          setName('');
          setDescription('');
        }
        setError('');
        setSaving(false);
      });
    }
  }, [open, initialValues]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch('/api/configs/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim(),
          protocol: 'vless',
          content: {},
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Failed to save template');
        return;
      }

      onSaved?.();
      onClose();
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Fork Template">
      <div className="space-y-4">
        <div>
          <label
            htmlFor="template-name"
            className="block text-sm font-medium mb-1"
          >
            Template Name
          </label>
          <Input
            id="template-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="Enter template name"
            disabled={saving}
          />
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>

        <div>
          <label
            htmlFor="template-description"
            className="block text-sm font-medium mb-1"
          >
            Description
          </label>
          <div className="relative">
            <textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this template is for"
              maxLength={200}
              disabled={saving}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              rows={3}
            />
            <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">
              {description.length}/200
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || name.trim().length < 2}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Copy
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
