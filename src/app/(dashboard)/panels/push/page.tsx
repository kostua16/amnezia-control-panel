'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Layers } from 'lucide-react';
import { ChainFlowEditor } from '@/components/chains/chain-flow-editor';
import type { Server } from '@/types/server';

interface PanelItem {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function PushConfigurationPage() {
  const [panels, setPanels] = useState<PanelItem[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Push Configuration</h1>
        <p className="text-muted-foreground mt-1">
          Build chain topology and push configuration to panels
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
        <ChainFlowEditor servers={servers} />
      )}
    </div>
  );
}
