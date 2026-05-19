'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { clsx } from 'clsx';
import { Plus, Trash2, Download, Upload, Edit2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { WhitelistEntry, WhitelistType } from '@/types/whitelist';
import type { Server } from '@/types/server';

interface WhitelistManagerProps {
  servers: Server[];
}

const typeLabels: Record<WhitelistType, string> = {
  domain: 'Domain',
  ip: 'IP Address',
  cidr: 'CIDR',
};

const typeColors: Record<WhitelistType, string> = {
  domain: 'bg-blue-500/20 text-blue-400',
  ip: 'bg-green-500/20 text-green-400',
  cidr: 'bg-purple-500/20 text-purple-400',
};

export function WhitelistManager({ servers }: WhitelistManagerProps) {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [addType, setAddType] = useState<WhitelistType>('domain');
  const [addValue, setAddValue] = useState('');
  const [addServerId, setAddServerId] = useState<string>('global');
  const [addDescription, setAddDescription] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Filter
  const [filterServer, setFilterServer] = useState<string>('all');

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterServer !== 'all') {
        params.set('serverId', filterServer);
      }
      const response = await fetch(`/api/routing/whitelist?${params}`);
      const result = await response.json();
      if (result.success) {
        setEntries(result.data);
      }
    } catch {
      // Silently handle fetch errors
    } finally {
      setLoading(false);
    }
  }, [filterServer]);

  useEffect(() => {
    startTransition(() => { fetchEntries(); });
  }, [fetchEntries]);

  const handleAdd = async () => {
    if (!addValue.trim()) return;
    setAdding(true);
    try {
      const response = await fetch('/api/routing/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: addType,
          value: addValue.trim(),
          description: addDescription.trim() || undefined,
          serverId: addServerId === 'global' ? null : Number(addServerId),
        }),
      });
      const result = await response.json();
      if (result.success) {
        setAddValue('');
        setAddDescription('');
        fetchEntries();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/routing/whitelist/${id}`, { method: 'DELETE' });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // Silently handle
    }
  };

  const handleStartEdit = (entry: WhitelistEntry) => {
    setEditingId(entry.id);
    setEditValue(entry.value);
    setEditDescription(entry.description ?? '');
  };

  const handleSaveEdit = async (id: number) => {
    try {
      const response = await fetch(`/api/routing/whitelist/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: editValue,
          description: editDescription || null,
        }),
      });
      const result = await response.json();
      if (result.success) {
        setEditingId(null);
        fetchEntries();
      } else {
        setEditingId(null);
      }
    } catch {
      setEditingId(null);
    }
  };

  const handleExport = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          entries.map((e) => ({
            type: e.type,
            value: e.value,
            description: e.description,
            serverId: e.serverId,
          })),
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'whitelist-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const items = JSON.parse(text) as Array<{
          type: WhitelistType;
          value: string;
          description?: string;
          serverId?: number | null;
        }>;
        for (const item of items) {
          await fetch('/api/routing/whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
        }
        fetchEntries();
      } catch {
        // Invalid JSON file
      }
    };
    input.click();
  };

  const filteredEntries =
    filterServer === 'all'
      ? entries
      : entries.filter(
          (e) => e.serverId === Number(filterServer) || e.serverId === null,
        );

  const serverLookup = new Map(servers.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      {/* Add entry form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Add Whitelist Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Type
              </label>
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value as WhitelistType)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="domain">Domain</option>
                <option value="ip">IP Address</option>
                <option value="cidr">CIDR</option>
              </select>
            </div>

            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Value
              </label>
              <Input
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                placeholder={
                  addType === 'domain'
                    ? 'example.com'
                    : addType === 'ip'
                      ? '192.168.1.1'
                      : '10.0.0.0/24'
                }
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Server
              </label>
              <select
                value={addServerId}
                onChange={(e) => setAddServerId(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="global">Global (all servers)</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[150px] flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Description
              </label>
              <Input
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <Button
              size="sm"
              onClick={handleAdd}
              disabled={adding || !addValue.trim()}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <select
          value={filterServer}
          onChange={(e) => setFilterServer(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="all">All servers</option>
          <option value="global">Global only</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export
        </Button>
        <Button variant="outline" size="sm" onClick={handleImport}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Import
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                Type
              </th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                Value
              </th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                Server
              </th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                Description
              </th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading...
                </td>
              </tr>
            )}
            {!loading && filteredEntries.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No whitelist entries found
                </td>
              </tr>
            )}
            {filteredEntries.map((entry) => (
              <tr
                key={entry.id}
                className={clsx(
                  'border-b border-border last:border-0',
                  !entry.isActive && 'opacity-50',
                )}
              >
                <td className="px-4 py-2">
                  <span
                    className={clsx(
                      'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                      typeColors[entry.type],
                    )}
                  >
                    {typeLabels[entry.type]}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {editingId === entry.id ? (
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(entry.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    entry.value
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {entry.serverId
                    ? (serverLookup.get(entry.serverId) ??
                      `Server #${entry.serverId}`)
                    : 'Global'}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {entry.description ?? '-'}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {editingId === entry.id ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleSaveEdit(entry.id)}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleStartEdit(entry)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDelete(entry.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
