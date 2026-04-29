'use client';

import { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Monitor,
  Plus,
  Pencil,
  Trash2,
  TestTube,
  RefreshCw,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { PanelStatusBadge } from './panel-status-badge';
import { AddPanelForm } from './add-panel-form';
import { EditPanelForm } from './edit-panel-form';
import { PanelDetailsDrawer } from './panel-details-drawer';
import type { PanelConnectionStatus } from '@/lib/panel-health-checker';

interface PanelItem {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function PanelList() {
  const [panels, setPanels] = useState<PanelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPanel, setEditingPanel] = useState<PanelItem | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [panelStatuses, setPanelStatuses] = useState<Record<number, PanelConnectionStatus>>({});
  const [selectedPanelId, setSelectedPanelId] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchPanels = useCallback(async () => {
    try {
      const res = await fetch('/api/panels');
      const json = await res.json();
      if (json.success) {
        setPanels(json.data);
        setFetchError(null);
      }
    } catch (err) {
      console.error('Failed to fetch panels:', err);
      if (panels.length === 0) {
        setFetchError('Failed to load panels. Check your network connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [panels.length]);

  const fetchPanelStatuses = useCallback(async (panelIds: number[]) => {
    const newStatuses: Record<number, PanelConnectionStatus> = {};
    for (const id of panelIds) {
      try {
        const res = await fetch(`/api/panels/${id}/status`);
        const json = await res.json();
        if (json.success) {
          newStatuses[id] = json.data.status;
        }
      } catch {
        // Individual status fetch failure is non-critical
      }
    }
    if (Object.keys(newStatuses).length > 0) {
      setPanelStatuses((prev) => ({ ...prev, ...newStatuses }));
    }
  }, []);

  useEffect(() => {
    fetchPanels();
  }, [fetchPanels]);

  // 30-second polling for statuses
  useEffect(() => {
    if (loading || panels.length === 0) return;

    const interval = setInterval(async () => {
      // Refresh panel list
      const listRes = await fetch('/api/panels');
      const listJson = await listRes.json();
      if (listJson.success) {
        setPanels(listJson.data);
      }

      // Fetch statuses for all panels
      fetchPanelStatuses(listJson.success ? listJson.data.map((p: PanelItem) => p.id) : panels.map((p) => p.id));
    }, 30_000);

    return () => clearInterval(interval);
  }, [loading, panels, fetchPanelStatuses]);

  const handleTestConnection = async (panelId: number) => {
    setTestingId(panelId);
    try {
      const res = await fetch(`/api/panels/${panelId}/test`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success) {
        setPanelStatuses((prev) => ({
          ...prev,
          [panelId]: json.data.success ? 'connected' : 'offline',
        }));
      }
    } catch {
      setPanelStatuses((prev) => ({
        ...prev,
        [panelId]: 'offline',
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (panelId: number) => {
    if (!confirm('Are you sure you want to remove this panel? This will delete all connection history. This cannot be undone.')) {
      return;
    }
    setDeletingId(panelId);
    try {
      const res = await fetch(`/api/panels/${panelId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setPanels((prev) => prev.filter((p) => p.id !== panelId));
        setPanelStatuses((prev) => {
          const next = { ...prev };
          delete next[panelId];
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to delete panel:', err);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading panels...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Panels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage remote panels and connection status
          </p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Panel
        </Button>
      </div>

      {fetchError && panels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-destructive mb-4">{fetchError}</p>
            <Button onClick={fetchPanels} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : panels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">No panels registered yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Add a remote panel to start managing your multi-panel topology.
            </p>
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Panel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Panels ({panels.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 pr-4 font-medium">Panel URL</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {panels.map((panel) => (
                    <tr key={panel.id} className="group">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{panel.name}</span>
                          {!panel.isActive && (
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              inactive
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {panel.panelUrl}
                      </td>
                      <td className="py-3 pr-4">
                        <PanelStatusBadge
                          status={panelStatuses[panel.id] ?? 'unknown'}
                        />
                      </td>
                      <td className="py-3">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleTestConnection(panel.id)}
                            disabled={testingId === panel.id}
                            aria-label="Test connection"
                          >
                            {testingId === panel.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <TestTube className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingPanel(panel)}
                            aria-label="Edit panel"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(panel.id)}
                            disabled={deletingId === panel.id}
                            aria-label="Remove panel"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedPanelId(panel.id)}
                            aria-label="Panel details"
                          >
                            <Info className="h-4 w-4" />
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
        title="Add Panel"
      >
        <AddPanelForm
          onPanelAdded={() => { setShowAddModal(false); fetchPanels(); }}
          onCancel={() => setShowAddModal(false)}
        />
      </Dialog>

      {editingPanel && (
        <Dialog open={!!editingPanel} onClose={() => setEditingPanel(null)} title="Edit Panel">
          <EditPanelForm
            panel={editingPanel}
            onPanelUpdated={() => { setEditingPanel(null); fetchPanels(); }}
            onCancel={() => setEditingPanel(null)}
          />
        </Dialog>
      )}

      {selectedPanelId !== null && (
        <PanelDetailsDrawer
          panelId={selectedPanelId}
          onClose={() => setSelectedPanelId(null)}
        />
      )}
    </div>
  );
}
