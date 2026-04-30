'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Layers } from 'lucide-react';
import { PushWizard } from '@/components/push/push-wizard';

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
  const [loading, setLoading] = useState(true);

  const fetchPanels = useCallback(async () => {
    try {
      const res = await fetch('/api/panels');
      const json = await res.json();
      if (json.success) {
        setPanels(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch panels:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPanels();
  }, [fetchPanels]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Push Configuration</h1>
        <p className="text-muted-foreground mt-1">
          Preview and push chain configuration to panels
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
          <p className="text-muted-foreground mb-1">No configuration changes to push</p>
          <p className="text-sm text-muted-foreground">
            Select a chain and panels to preview and push configuration changes.
          </p>
        </div>
      ) : (
        <PushWizard panels={panels} />
      )}
    </div>
  );
}
