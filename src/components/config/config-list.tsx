'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download,
  Upload,
  Trash2,
  RefreshCw,
  Loader2,
  FileJson,
  Zap,
  Shield,
  Globe,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

// ─── Types ──────────────────────────────────────────────

interface ConfigTemplateItem {
  id: number;
  name: string;
  serviceType: string | null;
  protocol: string;
  description: string;
  isBuiltIn: boolean;
}

interface ConfigPresetItem {
  name: string;
  label: string;
  description: string;
  serviceType: string;
  protocol: string;
  tags: string[];
}

interface ConfigImportReport {
  imported: number;
  skipped: number;
  updated: number;
  errors: string[];
}

// ─── Protocol Icons ─────────────────────────────────────

function ProtocolIcon({ protocol }: { protocol: string }) {
  switch (protocol) {
    case 'wireguard':
    case 'amneziawg':
      return <Shield className="h-4 w-4 text-blue-500" />;
    case 'vless':
      return <Zap className="h-4 w-4 text-green-500" />;
    case 'vmess':
      return <Globe className="h-4 w-4 text-orange-500" />;
    case 'trojan':
      return <Shield className="h-4 w-4 text-purple-500" />;
    case 'shadowsocks':
      return <FileJson className="h-4 w-4 text-yellow-500" />;
    default:
      return <FileJson className="h-4 w-4 text-muted-foreground" />;
  }
}

function ServiceBadge({ serviceType }: { serviceType: string | null }) {
  if (!serviceType) {
    return (
      <span className="inline-flex rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        Any
      </span>
    );
  }

  const isAwg = serviceType === 'AWG';

  return (
    <span
      className={clsx(
        'inline-flex rounded px-2 py-0.5 text-xs font-medium',
        isAwg
          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
          : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      )}
    >
      {isAwg ? 'AWG' : '3x-ui'}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────

export function ConfigList() {
  const [templates, setTemplates] = useState<ConfigTemplateItem[]>([]);
  const [presets, setPresets] = useState<ConfigPresetItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importReport, setImportReport] = useState<ConfigImportReport | null>(
    null,
  );
  const [importLoading, setImportLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<number | null>(null);
  const [selectedService, setSelectedService] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedService !== 'all') {
        params.set('serviceType', selectedService);
      }
      const query = params.toString();
      const response = await fetch(
        `/api/configs/templates${query ? `?${query}` : ''}`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch templates');
      }

      const result = await response.json();
      setTemplates(result.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedService]);

  // Fetch presets
  const fetchPresets = useCallback(async () => {
    try {
      const response = await fetch('/api/configs/presets');
      if (response.ok) {
        const result = await response.json();
        setPresets(result.data ?? []);
      }
    } catch {
      // Presets are non-critical
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchPresets();
  }, [fetchTemplates, fetchPresets]);

  // Handle export
  const handleExport = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedService !== 'all') {
        params.set('serviceType', selectedService);
      }
      const query = params.toString();
      const response = await fetch(
        `/api/configs/export${query ? `?${query}` : ''}`,
      );

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        response.headers
          .get('content-disposition')
          ?.replace(/attachment; filename="/, '')
          .replace(/"/, '') ?? 'amnezia-configs.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Failed to export configurations');
    }
  }, [selectedService]);

  // Handle import
  const handleImportClick = useCallback(() => {
    setImportReport(null);
    setImportDialogOpen(true);
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImportLoading(true);
      setImportReport(null);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/configs/import', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();

        if (result.success) {
          setImportReport(result.data);
          fetchTemplates();
        } else {
          setError(result.error || 'Import failed');
        }
      } catch {
        setError('Failed to import file');
      } finally {
        setImportLoading(false);
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [fetchTemplates],
  );

  // Handle delete
  const handleDeleteConfirm = useCallback(async () => {
    if (deleteConfirmId === null) return;

    setDeleteLoadingId(deleteConfirmId);
    setError(null);

    try {
      const response = await fetch(
        `/api/configs/templates/${deleteConfirmId}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok) {
        const result = await response.json();
        setError(result.error || 'Failed to delete template');
        return;
      }

      setDeleteConfirmId(null);
      fetchTemplates();
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setDeleteLoadingId(null);
    }
  }, [deleteConfirmId, fetchTemplates]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Configuration Templates</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button size="sm" variant="outline" onClick={handleImportClick}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Button size="sm" variant="ghost" onClick={fetchTemplates}>
              <RefreshCw
                className={clsx('h-4 w-4', isLoading && 'animate-spin')}
              />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error banner */}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Filters row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Service type filter */}
            <div className="flex items-center gap-1 rounded-md border border-border p-1">
              {[
                { value: 'all', label: 'All' },
                { value: 'AWG', label: 'AWG' },
                { value: 'THREE_XUI', label: '3x-ui' },
              ].map((option) => (
                <Button
                  key={option.value}
                  variant={
                    selectedService === option.value ? 'default' : 'ghost'
                  }
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setSelectedService(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {/* Preset selector */}
            {presets.length > 0 && (
              <select
                className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    fetch(`/api/configs/presets`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        presetName: e.target.value,
                      }),
                    })
                      .then((r) => r.json())
                      .then((result) => {
                        if (result.success) {
                          alert(
                            `Preset "${result.data.label}" applied. Config ready for generation.`,
                          );
                        }
                      })
                      .catch(() => {});
                    e.target.value = '';
                  }
                }}
              >
                <option value="" disabled>
                  Apply Preset...
                </option>
                {presets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.label} ({preset.protocol})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Templates table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No templates found. Create one or import configurations.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Template
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Service
                    </th>
                    <th className="hidden px-4 py-3 font-medium text-muted-foreground sm:table-cell">
                      Protocol
                    </th>
                    <th className="hidden px-4 py-3 font-medium text-muted-foreground md:table-cell">
                      Description
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => (
                    <tr
                      key={template.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ProtocolIcon protocol={template.protocol} />
                          <div>
                            <span className="font-medium">{template.name}</span>
                            {template.isBuiltIn && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Built-in
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ServiceBadge serviceType={template.serviceType} />
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {template.protocol}
                        </span>
                      </td>
                      <td className="hidden max-w-xs truncate px-4 py-3 text-sm text-muted-foreground md:table-cell">
                        {template.description}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {!template.isBuiltIn && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setDeleteConfirmId(template.id)}
                              aria-label={`Delete ${template.name}`}
                            >
                              {deleteLoadingId === template.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-destructive" />
                              )}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Delete confirmation */}
          {deleteConfirmId !== null && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-foreground">
                Are you sure you want to delete this template? This action
                cannot be undone.
              </p>
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteConfirmId(null)}
                  disabled={deleteLoadingId !== null}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteConfirm}
                  disabled={deleteLoadingId !== null}
                >
                  {deleteLoadingId !== null && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Dialog */}
      <Dialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title="Import Configurations"
      >
        <div className="space-y-4">
          {!importReport ? (
            <>
              <p className="text-sm text-muted-foreground">
                Upload a JSON file exported from Amnezia Control Panel to import
                configurations and templates.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-foreground hover:file:bg-accent/90"
              />
              {importLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium">Import Complete</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Imported</span>
                  <span className="font-medium text-green-600">
                    {importReport.imported}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="font-medium text-blue-600">
                    {importReport.updated}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Skipped</span>
                  <span className="font-medium">{importReport.skipped}</span>
                </div>
                {importReport.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-destructive font-medium">Errors</p>
                    {importReport.errors.map((err, i) => (
                      <p key={i} className="text-xs text-destructive">
                        {err}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setImportReport(null);
                    setImportDialogOpen(false);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
