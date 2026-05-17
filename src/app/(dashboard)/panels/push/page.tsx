'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Layers, GitBranch, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import { PushWizard } from '@/components/push/push-wizard';
import { ChainFlowEditor } from '@/components/chains/chain-flow-editor';
import { buildServerPanelMap } from '@/lib/build-server-panel-map';
import type { Server } from '@/types/server';
import type { RemotePanel } from '@/types/remote-panel';

interface PanelItem {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type ViewTab = 'push' | 'editor';

export default function PushConfigurationPage() {
  const [panels, setPanels] = useState<PanelItem[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewTab>('push');

  const fetchData = useCallback(async () => {
    try {
      const [panelsRes, serversRes] = await Promise.all([
        fetch('/api/panels'),
        fetch('/api/servers'),
      ]);
      const panelsJson = await panelsRes.json();
      const serversJson = await serversRes.json();
      if (panelsJson.success) setPanels(panelsJson.data);
      if (serversJson.success) setServers(serversJson.data);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build server-to-panel mapping for ChainFlowEditor panel boundaries
  const serverPanelMap = useMemo(
    () => buildServerPanelMap(servers, panels),
    [servers, panels],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Push Configuration</h1>
        <p className="text-muted-foreground mt-1">
          Push chain configurations to remote panels or visually edit chain topology
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading...</span>
        </div>
      ) : panels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-12">
          <Layers className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-1">No panels configured</p>
          <p className="text-sm text-muted-foreground">
            Register remote panels to push chain configurations.
          </p>
        </div>
      ) : (
        <>
          {/* Tab toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
            <button
              onClick={() => setActiveTab('push')}
              className={clsx(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === 'push'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Push to Panels
            </button>
            <button
              onClick={() => setActiveTab('editor')}
              className={clsx(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === 'editor'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              Visual Chain Editor
            </button>
          </div>

          {/* Push Wizard (primary) */}
          {activeTab === 'push' && (
            <PushWizard panels={panels} />
          )}

          {/* Visual Chain Editor (secondary reference view) */}
          {activeTab === 'editor' && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Visual reference -- panel boundaries shown for configured servers
                </p>
              </div>
              <ChainFlowEditor
                servers={servers}
                panels={panels as unknown as RemotePanel[]}
                serverPanelMap={serverPanelMap}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
