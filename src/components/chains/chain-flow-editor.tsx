'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ChainFlowNode } from './chain-flow-node';
import { PanelGroupNode } from './panel-group-node';
import { ChainTemplatesList } from './chain-templates-list';
import { ChainNodeRoutingDrawer } from './chain-node-routing-drawer';
import { ChainControls } from './chain-controls';
import { ChainCanvas } from './chain-canvas';
import { SaveChainDialog } from './save-chain-dialog';
import { useChainFlowActions } from './use-chain-flow-actions';
import { Dialog } from '@/components/ui/dialog';
import {
  getInvalidDirectGeoipTags,
  hasDirectGeoipTags,
} from '@/lib/chain-routing-options';
import type { Node } from '@xyflow/react';
import type { ChainTemplate } from '@/types/chain';
import type { ChainBuilderNode } from '@/lib/chain-flow-utils';
import type { Server } from '@/types/server';
import type { RemotePanel } from '@/types/remote-panel';

interface ChainFlowEditorProps {
  servers: Server[];
  panels?: RemotePanel[];
  serverPanelMap?: Record<number, number>;
  chainId?: number | null;
  onApply?: (templateId: string, serverMapping: Record<number, number>) => void;
}

export function ChainFlowEditor({
  servers,
  panels,
  serverPanelMap,
  chainId,
  onApply,
}: ChainFlowEditorProps) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [routingDrawerOpen, setRoutingDrawerOpen] = useState(false);
  const [selectedDrawerNode, setSelectedDrawerNode] =
    useState<ChainBuilderNode | null>(null);
  const [deleteConfirmNodeId, setDeleteConfirmNodeId] = useState<string | null>(
    null,
  );
  // Direct GeoIP zones for split routing (comma-separated, e.g. "ru, kz, de").
  const [splitDirectGeoipTags, setSplitDirectGeoipTags] = useState('');

  const addMenuRef = useRef<HTMLDivElement>(null);

  const {
    topology,
    setTopology,
    localNodes,
    selectedTemplate,
    selectTemplate,
    handleAddNode,
    onConnect,
    deleteNodes,
    reactFlowNodes,
    reactFlowEdges,
    onNodesChange,
    onEdgesChange,
  } = useChainFlowActions({
    servers,
    serverPanelMap,
    panels,
    onPromptDeleteNode: setDeleteConfirmNodeId,
  });

  // Register custom node types (memoized)
  const nodeTypes = useMemo(
    () => ({ chainNode: ChainFlowNode, panelGroup: PanelGroupNode }),
    [],
  );

  // Close add menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as HTMLElement)
      ) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelectTemplate = useCallback(
    (template: ChainTemplate) => {
      selectTemplate(template);
      setShowTemplates(false);
    },
    [selectTemplate],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'chainNode') {
        const builderNode = localNodes.find((n) => n.id === node.id);
        if (builderNode) {
          setSelectedDrawerNode(builderNode);
          setRoutingDrawerOpen(true);
        }
      }
    },
    [localNodes],
  );

  const onPaneClick = useCallback(() => {
    setRoutingDrawerOpen(false);
    setSelectedDrawerNode(null);
  }, []);

  const handleConfirmDeleteNode = useCallback(() => {
    if (deleteConfirmNodeId === null) return;
    deleteNodes(new Set([deleteConfirmNodeId]));
    setDeleteConfirmNodeId(null);
    setRoutingDrawerOpen(false);
    setSelectedDrawerNode(null);
  }, [deleteConfirmNodeId, deleteNodes]);

  const handleAddNodeAndCloseMenu = useCallback(
    (serverId: number) => {
      handleAddNode(serverId);
      setShowAddMenu(false);
    },
    [handleAddNode],
  );

  // Split routing requires at least one valid direct GeoIP zone; invalid tags
  // block saving until corrected. Mirrors the split-routing guard on main.
  const splitZonesMissing =
    topology === 'split' && !hasDirectGeoipTags(splitDirectGeoipTags);
  const invalidSplitGeoipTags =
    topology === 'split' ? getInvalidDirectGeoipTags(splitDirectGeoipTags) : [];

  const handleSaveClick = useCallback(() => {
    if (localNodes.length === 0 || splitZonesMissing) return;
    setSaveDialogOpen(true);
  }, [localNodes.length, splitZonesMissing]);

  return (
    <div className="space-y-4">
      <ChainControls
        topology={topology}
        onTopologyChange={setTopology}
        onToggleTemplates={() => setShowTemplates(!showTemplates)}
        showAddMenu={showAddMenu}
        onToggleAddMenu={() => setShowAddMenu(!showAddMenu)}
        addMenuRef={addMenuRef}
        servers={servers}
        onAddNode={handleAddNodeAndCloseMenu}
        onSave={handleSaveClick}
        nodeCount={localNodes.length}
        splitDirectGeoipTags={splitDirectGeoipTags}
        onSplitDirectGeoipTagsChange={setSplitDirectGeoipTags}
        invalidSplitGeoipTags={invalidSplitGeoipTags}
        splitZonesMissing={splitZonesMissing}
      />

      {/* Template selector panel */}
      {showTemplates && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Choose a template</CardTitle>
          </CardHeader>
          <CardContent>
            <ChainTemplatesList
              selectedId={selectedTemplate?.id}
              onSelect={handleSelectTemplate}
              filterTopology={topology}
            />
          </CardContent>
        </Card>
      )}

      <ChainCanvas
        nodes={reactFlowNodes}
        edges={reactFlowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        isEmpty={localNodes.length === 0}
        serversDisabled={servers.length === 0}
        onAddNodeClick={() => setShowAddMenu(true)}
      />

      <ChainNodeRoutingDrawer
        open={routingDrawerOpen}
        onClose={() => {
          setRoutingDrawerOpen(false);
          setSelectedDrawerNode(null);
        }}
        node={selectedDrawerNode}
        chainId={chainId}
      />

      {/* Delete node confirmation dialog */}
      <Dialog
        open={deleteConfirmNodeId !== null}
        onClose={() => setDeleteConfirmNodeId(null)}
        title="Remove Node"
      >
        <p className="text-sm text-foreground">
          Remove this node and all its connections?
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteConfirmNodeId(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirmDeleteNode}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
      </Dialog>

      <SaveChainDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        localNodes={localNodes}
        selectedTemplate={selectedTemplate}
        serverPanelMap={serverPanelMap}
        panels={panels}
        topology={topology}
        splitDirectGeoipTags={splitDirectGeoipTags}
        onApplied={(templateId, serverMapping) =>
          onApply?.(templateId, serverMapping)
        }
      />
    </div>
  );
}
