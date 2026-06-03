'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { clsx } from 'clsx';
import { RefreshCw, Shield, Pencil, Save, X, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';

interface ServiceInfo {
  id: number;
  type: string;
  status: string;
  port: number | null;
}

interface ServerConfigData {
  id: number;
  name: string;
  hostname: string;
  port: number;
  isActive: boolean;
  services: ServiceInfo[];
}

interface ServerConfigProps {
  serverId: number;
}

export function ServerConfig({ serverId }: ServerConfigProps) {
  const [config, setConfig] = useState<ServerConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<{
    name: string;
    hostname: string;
    port: string;
    apiKey: string;
    isActive: boolean;
  }>({ name: '', hostname: '', port: '', apiKey: '', isActive: true });
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState(true);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}`);
      const json = await res.json();
      if (json.success) {
        setConfig(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch server config:', err);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    startTransition(() => {
      fetchConfig();
    });
  }, [fetchConfig]);

  const handleEdit = () => {
    if (!config) return;
    setEditData({
      name: config.name,
      hostname: config.hostname,
      port: String(config.port),
      apiKey: '',
      isActive: config.isActive,
    });
    setApiKeyMasked(true);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: editData.name,
        hostname: editData.hostname,
        port: Number(editData.port),
        isActive: editData.isActive,
      };
      // Only include apiKey if the user entered a new one
      if (editData.apiKey.trim()) {
        body.apiKey = editData.apiKey.trim();
      }

      const res = await fetch(`/api/servers/${serverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setConfig(json.data);
        setEditing(false);
      }
    } catch (err) {
      console.error('Failed to save server config:', err);
    } finally {
      setSaving(false);
    }
  };

  const getServiceSlug = (serviceType: string): string => {
    // Map Prisma enum values to service endpoint slugs
    switch (serviceType) {
      case 'AWG':
        return 'awg';
      case 'THREE_XUI':
        return '3x-ui';
      default:
        return serviceType.toLowerCase();
    }
  };

  const handleToggleService = async (
    _serviceId: number,
    serviceType: string,
    _currentStatus: string,
  ) => {
    // Toggle service active state via the service endpoint
    // The service status endpoint uses slug-based routing (awg, 3x-ui)
    const slug = getServiceSlug(serviceType);
    try {
      const res = await fetch(`/api/services/${slug}/status`);
      if (res.ok) {
        fetchConfig();
      }
    } catch (err) {
      console.error('Failed to toggle service:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">
          Loading server configuration...
        </span>
      </div>
    );
  }

  if (!config) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Server configuration not found
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{config.name}</h2>
          <p className="text-sm text-muted-foreground">
            {config.hostname}:{config.port}
          </p>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCancelEdit}
                title="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Server Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server Settings</CardTitle>
          <CardDescription>
            Connection settings and API key management
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={editData.name}
                  onChange={(e) =>
                    setEditData((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Hostname</label>
                <Input
                  value={editData.hostname}
                  onChange={(e) =>
                    setEditData((prev) => ({
                      ...prev,
                      hostname: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Port</label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={editData.port}
                  onChange={(e) =>
                    setEditData((prev) => ({ ...prev, port: e.target.value }))
                  }
                  className="w-32"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Status</label>
                <div className="flex items-center gap-3 h-10">
                  <button
                    type="button"
                    onClick={() =>
                      setEditData((prev) => ({
                        ...prev,
                        isActive: !prev.isActive,
                      }))
                    }
                    className={clsx(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                      editData.isActive ? 'bg-green-500' : 'bg-gray-300',
                    )}
                  >
                    <span
                      className={clsx(
                        'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                        editData.isActive ? 'translate-x-6' : 'translate-x-1',
                      )}
                    />
                  </button>
                  <span className="text-sm">
                    {editData.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">
                  API Key{' '}
                  <span className="text-muted-foreground font-normal">
                    (leave blank to keep current)
                  </span>
                </label>
                <div className="relative">
                  <Input
                    type={showApiKey && !apiKeyMasked ? 'text' : 'password'}
                    placeholder="Enter new API key to rotate"
                    value={editData.apiKey}
                    onChange={(e) =>
                      setEditData((prev) => ({
                        ...prev,
                        apiKey: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey && !apiKeyMasked ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{config.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Hostname</p>
                <p className="font-medium">{config.hostname}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Port</p>
                <p className="font-medium">{config.port}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'h-2 w-2 rounded-full',
                      config.isActive ? 'bg-green-500' : 'bg-gray-400',
                    )}
                  />
                  <span className="font-medium">
                    {config.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">API Key</p>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-sm">
                    {apiKeyMasked
                      ? '••••••••••••••••'
                      : 'hashed (not retrievable)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setApiKeyMasked((prev) => !prev)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {apiKeyMasked ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Services */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Services</CardTitle>
          <CardDescription>VPN services running on this server</CardDescription>
        </CardHeader>
        <CardContent>
          {config.services.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No services configured on this server
            </p>
          ) : (
            <div className="space-y-3">
              {config.services.map((service) => (
                <div
                  key={service.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={clsx(
                        'h-2.5 w-2.5 rounded-full',
                        service.status === 'RUNNING'
                          ? 'bg-green-500'
                          : service.status === 'ERROR'
                            ? 'bg-red-500'
                            : 'bg-gray-400',
                      )}
                    />
                    <div>
                      <p className="font-medium text-sm">{service.type}</p>
                      {service.port && (
                        <p className="text-xs text-muted-foreground">
                          Port {service.port}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'text-xs font-medium px-2 py-0.5 rounded',
                        service.status === 'RUNNING'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : service.status === 'ERROR'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
                      )}
                    >
                      {service.status}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleService(
                          service.id,
                          service.type,
                          service.status,
                        )
                      }
                      className={clsx(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                        service.status === 'RUNNING'
                          ? 'bg-green-500'
                          : 'bg-gray-300',
                      )}
                    >
                      <span
                        className={clsx(
                          'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                          service.status === 'RUNNING'
                            ? 'translate-x-4.5'
                            : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
