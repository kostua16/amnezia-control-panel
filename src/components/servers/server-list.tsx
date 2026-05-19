'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { clsx } from 'clsx';
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  TestTube,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { AddServerForm } from './add-server-form';
import type { ServerConnectionStatus } from '@/types/server';

interface ServerItem {
  id: number;
  name: string;
  hostname: string;
  port: number;
  isActive: boolean;
  services: Array<{
    id: number;
    type: string;
    status: string;
    port: number | null;
  }>;
  createdAt: string;
}

function StatusIndicator({ status }: { status: ServerConnectionStatus }) {
  const colors: Record<ServerConnectionStatus, string> = {
    connected: 'bg-green-500',
    offline: 'bg-red-500',
    unknown: 'bg-gray-400',
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={clsx('h-2.5 w-2.5 rounded-full', colors[status])}
        title={status}
      />
      <span className="text-sm capitalize">{status}</span>
    </span>
  );
}

export function ServerList() {
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [connectionStatuses, setConnectionStatuses] = useState<
    Record<number, ServerConnectionStatus>
  >({});

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch('/api/servers');
      const json = await res.json();
      if (json.success) {
        setServers(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch servers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => { fetchServers(); });
  }, [fetchServers]);

  const handleTestConnection = async (serverId: number) => {
    setTestingId(serverId);
    try {
      const res = await fetch(`/api/servers/${serverId}/test`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success) {
        setConnectionStatuses((prev) => ({
          ...prev,
          [serverId]: json.data.success ? 'connected' : 'offline',
        }));
      }
    } catch {
      setConnectionStatuses((prev) => ({
        ...prev,
        [serverId]: 'offline',
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (serverId: number) => {
    if (
      !confirm(
        'Are you sure you want to delete this server? This cannot be undone.',
      )
    ) {
      return;
    }
    setDeletingId(serverId);
    try {
      const res = await fetch(`/api/servers/${serverId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setServers((prev) => prev.filter((s) => s.id !== serverId));
        setConnectionStatuses((prev) => {
          const next = { ...prev };
          delete next[serverId];
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to delete server:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleServerAdded = () => {
    setShowAddModal(false);
    fetchServers();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading servers...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Servers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your VPN servers and connections
          </p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Button>
      </div>

      {servers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              No servers configured yet
            </p>
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Server
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Servers ({servers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 pr-4 font-medium">Hostname</th>
                    <th className="pb-3 pr-4 font-medium">Port</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 pr-4 font-medium">Services</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {servers.map((server) => (
                    <tr key={server.id} className="group">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{server.name}</span>
                          {!server.isActive && (
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              inactive
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {server.hostname}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {server.port}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusIndicator
                          status={connectionStatuses[server.id] ?? 'unknown'}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex gap-1">
                          {server.services.length === 0 ? (
                            <span className="text-muted-foreground">None</span>
                          ) : (
                            server.services.map((svc) => (
                              <span
                                key={svc.id}
                                className={clsx(
                                  'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
                                  svc.status === 'RUNNING'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                    : svc.status === 'ERROR'
                                      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
                                )}
                              >
                                {svc.type}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleTestConnection(server.id)}
                            disabled={testingId === server.id}
                            title="Test Connection"
                          >
                            {testingId === server.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <TestTube className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit Server"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(server.id)}
                            disabled={deletingId === server.id}
                            title="Delete Server"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Server"
      >
        <AddServerForm
          onServerAdded={handleServerAdded}
          onCancel={() => setShowAddModal(false)}
        />
      </Dialog>
    </div>
  );
}
