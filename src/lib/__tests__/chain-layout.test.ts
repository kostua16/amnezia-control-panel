import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateNodePositions,
  calculateConnections,
  NODE_WIDTH,
  NODE_HEIGHT,
  CANVAS_PADDING,
} from '../chain-layout';

const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 60;

function makeNodes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
  }));
}

describe('calculateNodePositions', () => {
  it('returns empty array for zero nodes', () => {
    const result = calculateNodePositions([], 'linear');
    assert.deepStrictEqual(result, []);
  });

  describe('linear topology', () => {
    it('places a single node at canvas padding', () => {
      const nodes = makeNodes(1);
      const positions = calculateNodePositions(nodes, 'linear');
      assert.strictEqual(positions.length, 1);
      assert.deepStrictEqual(positions[0], {
        id: 'n0',
        x: CANVAS_PADDING,
        y: CANVAS_PADDING,
      });
    });

    it('places nodes in a horizontal row', () => {
      const nodes = makeNodes(3);
      const positions = calculateNodePositions(nodes, 'linear');
      assert.strictEqual(positions.length, 3);

      // First node
      assert.strictEqual(positions[0].x, CANVAS_PADDING);
      // Second node offset by width + gap
      assert.strictEqual(
        positions[1].x,
        CANVAS_PADDING + NODE_WIDTH + HORIZONTAL_GAP,
      );
      // Third node further along
      assert.strictEqual(
        positions[2].x,
        CANVAS_PADDING + 2 * (NODE_WIDTH + HORIZONTAL_GAP),
      );

      // All at same Y
      assert.strictEqual(positions[0].y, CANVAS_PADDING);
      assert.strictEqual(positions[1].y, CANVAS_PADDING);
      assert.strictEqual(positions[2].y, CANVAS_PADDING);
    });
  });

  describe('split topology', () => {
    it('places first node at top-left, rest branching below', () => {
      const nodes = makeNodes(3);
      const positions = calculateNodePositions(nodes, 'split');
      assert.strictEqual(positions.length, 3);

      // Entry node at top-left
      assert.strictEqual(positions[0].x, CANVAS_PADDING);
      assert.strictEqual(positions[0].y, CANVAS_PADDING);

      // Branch nodes below
      assert.strictEqual(
        positions[1].x,
        CANVAS_PADDING + NODE_WIDTH + HORIZONTAL_GAP,
      );
      assert.strictEqual(
        positions[1].y,
        CANVAS_PADDING + NODE_HEIGHT + VERTICAL_GAP,
      );
    });
  });

  describe('mesh topology', () => {
    it('lays out nodes in a grid', () => {
      const nodes = makeNodes(4);
      const positions = calculateNodePositions(nodes, 'mesh');
      assert.strictEqual(positions.length, 4);

      // 4 nodes → 2x2 grid
      // Row 0: positions[0], positions[1]
      // Row 1: positions[2], positions[3]
      assert.strictEqual(positions[0].x, CANVAS_PADDING);
      assert.strictEqual(
        positions[1].x,
        CANVAS_PADDING + NODE_WIDTH + HORIZONTAL_GAP,
      );
      assert.strictEqual(positions[2].x, CANVAS_PADDING);
      assert.strictEqual(
        positions[3].x,
        CANVAS_PADDING + NODE_WIDTH + HORIZONTAL_GAP,
      );

      assert.strictEqual(positions[0].y, CANVAS_PADDING);
      assert.strictEqual(positions[1].y, CANVAS_PADDING);
      assert.strictEqual(
        positions[2].y,
        CANVAS_PADDING + NODE_HEIGHT + VERTICAL_GAP,
      );
      assert.strictEqual(
        positions[3].y,
        CANVAS_PADDING + NODE_HEIGHT + VERTICAL_GAP,
      );
    });

    it('handles odd number of nodes (3 nodes → 2 columns)', () => {
      const nodes = makeNodes(3);
      const positions = calculateNodePositions(nodes, 'mesh');
      assert.strictEqual(positions.length, 3);
      // Node 2 is in row 1, col 0
      assert.strictEqual(positions[2].x, CANVAS_PADDING);
      assert.strictEqual(
        positions[2].y,
        CANVAS_PADDING + NODE_HEIGHT + VERTICAL_GAP,
      );
    });
  });
});

describe('calculateConnections', () => {
  const positions = (ids: string[]) => ids.map((id) => ({ id, x: 0, y: 0 }));

  it('returns empty for fewer than 2 positions', () => {
    assert.deepStrictEqual(calculateConnections([], 'linear'), []);
    assert.deepStrictEqual(
      calculateConnections(positions(['a']), 'linear'),
      [],
    );
  });

  it('connects nodes sequentially for linear topology', () => {
    const result = calculateConnections(positions(['a', 'b', 'c']), 'linear');
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result[0], { from: 'a', to: 'b' });
    assert.deepStrictEqual(result[1], { from: 'b', to: 'c' });
  });

  it('connects entry to all others for split topology', () => {
    const result = calculateConnections(
      positions(['entry', 'b1', 'b2']),
      'split',
    );
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result[0], { from: 'entry', to: 'b1' });
    assert.deepStrictEqual(result[1], { from: 'entry', to: 'b2' });
  });

  it('connects all nodes to each other for mesh topology', () => {
    const result = calculateConnections(positions(['a', 'b', 'c']), 'mesh');
    // 3 nodes → 3 connections (a-b, a-c, b-c)
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result[0], { from: 'a', to: 'b' });
    assert.deepStrictEqual(result[1], { from: 'a', to: 'c' });
    assert.deepStrictEqual(result[2], { from: 'b', to: 'c' });
  });
});
