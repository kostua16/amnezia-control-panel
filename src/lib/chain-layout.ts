import type { ChainTopology } from '@/types/chain';

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

interface LayoutNode {
  id: string;
  label: string;
}

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 100;
const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 60;
export const CANVAS_PADDING = 40;

/**
 * Calculate x,y positions for chain nodes based on topology.
 *
 * Supports:
 * - linear: horizontal left-to-right flow
 * - split: branching from a central entry node
 * - mesh: grid layout with all-to-all connections implied
 */
export function calculateNodePositions(
  nodes: LayoutNode[],
  topology: ChainTopology,
): NodePosition[] {
  if (nodes.length === 0) return [];

  switch (topology) {
    case 'linear':
      return linearLayout(nodes);
    case 'split':
      return splitLayout(nodes);
    case 'mesh':
      return meshLayout(nodes);
  }
}

function linearLayout(nodes: LayoutNode[]): NodePosition[] {
  const positions: NodePosition[] = [];
  const startX = CANVAS_PADDING;

  for (let i = 0; i < nodes.length; i++) {
    positions.push({
      id: nodes[i].id,
      x: startX + i * (NODE_WIDTH + HORIZONTAL_GAP),
      y: CANVAS_PADDING,
    });
  }

  return positions;
}

function splitLayout(nodes: LayoutNode[]): NodePosition[] {
  const positions: NodePosition[] = [];
  const centerX = CANVAS_PADDING;
  const startY = CANVAS_PADDING;

  // First node is the entry (top center)
  positions.push({
    id: nodes[0].id,
    x: centerX,
    y: startY,
  });

  // Remaining nodes branch out below
  for (let i = 1; i < nodes.length; i++) {
    positions.push({
      id: nodes[i].id,
      x: centerX + i * (NODE_WIDTH + HORIZONTAL_GAP),
      y: startY + NODE_HEIGHT + VERTICAL_GAP,
    });
  }

  return positions;
}

function meshLayout(nodes: LayoutNode[]): NodePosition[] {
  const positions: NodePosition[] = [];
  const cols = Math.ceil(Math.sqrt(nodes.length));

  for (let i = 0; i < nodes.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      id: nodes[i].id,
      x: CANVAS_PADDING + col * (NODE_WIDTH + HORIZONTAL_GAP),
      y: CANVAS_PADDING + row * (NODE_HEIGHT + VERTICAL_GAP),
    });
  }

  return positions;
}

/**
 * Compute SVG connection lines between nodes.
 *
 * For linear: connects each node to the next.
 * For split: connects entry to every branch node.
 * For mesh: connects every node to every other node.
 */
export function calculateConnections(
  positions: NodePosition[],
  topology: ChainTopology,
): Array<{ from: string; to: string }> {
  if (positions.length < 2) return [];

  switch (topology) {
    case 'linear':
      return positions.slice(0, -1).map((pos, i) => ({
        from: pos.id,
        to: positions[i + 1].id,
      }));

    case 'split':
      // Entry node (first) connects to all others
      return positions.slice(1).map((pos) => ({
        from: positions[0].id,
        to: pos.id,
      }));

    case 'mesh':
      // All-to-all connections
      const connections: Array<{ from: string; to: string }> = [];
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          connections.push({
            from: positions[i].id,
            to: positions[j].id,
          });
        }
      }
      return connections;
  }
}
