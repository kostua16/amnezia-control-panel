'use client';

import { Plus } from 'lucide-react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';

const defaultEdgeOptions: Partial<Edge> = {
  type: 'smoothstep',
  animated: false,
  style: { stroke: '#94a3b8', strokeWidth: 1.5 },
};

interface ChainCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onNodesDelete: (nodes: Node[]) => void;
  onEdgesDelete: (edges: Edge[]) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
  nodeTypes: NodeTypes;
  isEmpty: boolean;
  serversDisabled: boolean;
  onAddNodeClick: () => void;
}

export function ChainCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onNodeClick,
  onPaneClick,
  nodeTypes,
  isEmpty,
  serversDisabled,
  onAddNodeClick,
}: ChainCanvasProps) {
  return (
    <div className="relative h-[500px] rounded-lg border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        minZoom={0.3}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Controls position="bottom-right" />
        <MiniMap position="bottom-left" />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#334155"
        />
      </ReactFlow>

      {/* Empty state overlay */}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <h3 className="mb-1 text-sm text-muted-foreground">
              No chain topology yet
            </h3>
            <p className="mb-3 max-w-xs text-xs text-muted-foreground">
              Select a template or add nodes to build a chain. Drag from a node
              handle to connect it to another node.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="pointer-events-auto"
              onClick={onAddNodeClick}
              disabled={serversDisabled}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Node
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
