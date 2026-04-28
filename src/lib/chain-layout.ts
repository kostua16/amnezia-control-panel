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

const NODE_WIDTH = 200;
const NODE_HEIGHT = 100;
const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 60;
const CANVAS_PADDING = 40;

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
  const totalWidth = nodes.length * NODE_WIDTH + (nodes.length - 1) * HORIZONTAL_GAP;
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
  const branchCount = nodes.length - 1;
  const branchTotalHeight =
    branchCount * NODE_HEIGHT + (branchCount - 1) * VERTICAL_GAP;
  const startY = CANVAS_PADDING;

  // Entry node at left center
  const entryY = startY + branchTotalHeight / 2 - NODE_HEIGHT / 2;
  positions.push({
    id: nodes[0].id,
    x: CANVAS_PADDING,
    y: entryY,
  });

  // Branch nodes to the right
  const branchStartX = CANVAS_PADDING + NODE_WIDTH + HORIZONTAL_GAP;
  for (let i = 1; i < nodes.length; i++) {
    positions.push({
      id: nodes[i].id,
      x: branchStartX,
      y: startY + (i - 1) * (NODE_HEIGHT + VERTICAL_GAP),
    });
  }

  return positions;
}

function meshLayout(nodes: LayoutNode[]): NodePosition[] {
  const positions: NodePosition[] = [];
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);

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
): Array<{ from: NodePosition; to: NodePosition }> {
  const connections: Array<{ from: NodePosition; to: NodePosition }> = [];

  switch (topology) {
    case 'linear': {
      for (let i = 0; i < positions.length - 1; i++) {
        connections.push({ from: positions[i], to: positions[i + 1] });
      }
      break;
    }
    case 'split': {
      if (positions.length < 2) break;
      const entry = positions[0];
      for (let i = 1; i < positions.length; i++) {
        connections.push({ from: entry, to: positions[i] });
      }
      break;
    }
    case 'mesh': {
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          connections.push({ from: positions[i], to: positions[j] });
        }
      }
      break;
    }
  }

  return connections;
}

export { NODE_WIDTH, NODE_HEIGHT, HORIZONTAL_GAP, VERTICAL_GAP, CANVAS_PADDING };
