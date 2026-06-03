import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toFlowNodes,
  toFlowEdges,
  reassignRoles,
  getDefaultPositions,
  generateNodeId,
} from '../chain-flow-utils';
import type { ChainBuilderNode } from '../chain-flow-utils';

const sampleNodes: ChainBuilderNode[] = [
  {
    id: 'n1',
    serverId: 1,
    label: 'Entry',
    role: 'entry',
    protocol: 'wireguard',
  },
  { id: 'n2', serverId: 2, label: 'Exit', role: 'exit', protocol: 'xray' },
];

describe('chain-flow-utils', () => {
  describe('toFlowNodes', () => {
    it('maps builder nodes to React Flow nodes with positions', () => {
      const positions = { n1: { x: 40, y: 40 }, n2: { x: 340, y: 40 } };
      const result = toFlowNodes(sampleNodes, positions);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'n1');
      assert.strictEqual(result[0].type, 'chainNode');
      assert.deepEqual(result[0].position, { x: 40, y: 40 });
      assert.strictEqual(result[0].data.label, 'Entry');
    });

    it('falls back to CANVAS_PADDING when position missing', () => {
      const result = toFlowNodes(sampleNodes, {});

      assert.strictEqual(result[0].position.x, 40);
      assert.strictEqual(result[0].position.y, 40);
    });
  });

  describe('toFlowEdges', () => {
    it('creates edges from connections', () => {
      const connections = [{ fromId: 'n1', toId: 'n2' }];
      const result = toFlowEdges(connections);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].source, 'n1');
      assert.strictEqual(result[0].target, 'n2');
      assert.strictEqual(result[0].type, 'smoothstep');
    });

    it('applies dashed style for cross-panel edges', () => {
      const connections = [{ fromId: 'n1', toId: 'n2' }];
      const isCrossPanel = () => true;
      const result = toFlowEdges(connections, isCrossPanel);

      assert.ok(result[0].style?.strokeDasharray);
    });

    it('populates cross-panel edge data when all options provided', () => {
      const connections = [{ fromId: 'n1', toId: 'n2' }];
      const isCrossPanel = () => true;
      const result = toFlowEdges(connections, isCrossPanel, {
        panels: [
          {
            id: 10,
            name: 'Panel A',
            panelUrl: 'http://a',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 20,
            name: 'Panel B',
            panelUrl: 'http://b',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        serverPanelMap: { 1: 10, 2: 20 },
        builderNodes: sampleNodes,
      });

      assert.ok(result[0].data);
      assert.strictEqual(result[0].data.crossPanel, true);
      assert.strictEqual(result[0].data.sourcePanelName, 'Panel A');
      assert.strictEqual(result[0].data.targetPanelName, 'Panel B');
    });

    it('returns solid style for same-panel edges', () => {
      const connections = [{ fromId: 'n1', toId: 'n2' }];
      const result = toFlowEdges(connections);

      assert.strictEqual(result[0].style?.strokeDasharray, undefined);
    });
  });

  describe('reassignRoles', () => {
    it('assigns entry to first, exit to last, middle to rest', () => {
      const nodes: ChainBuilderNode[] = [
        {
          id: 'a',
          serverId: 1,
          label: 'A',
          role: 'middle',
          protocol: 'wireguard',
        },
        {
          id: 'b',
          serverId: 2,
          label: 'B',
          role: 'middle',
          protocol: 'wireguard',
        },
        { id: 'c', serverId: 3, label: 'C', role: 'middle', protocol: 'xray' },
      ];

      const result = reassignRoles(nodes);

      assert.strictEqual(result[0].role, 'entry');
      assert.strictEqual(result[1].role, 'middle');
      assert.strictEqual(result[2].role, 'exit');
    });

    it('returns empty array for empty input', () => {
      assert.deepEqual(reassignRoles([]), []);
    });

    it('handles single node as both entry and exit', () => {
      const nodes: ChainBuilderNode[] = [
        {
          id: 'solo',
          serverId: 1,
          label: 'Solo',
          role: 'middle',
          protocol: 'wireguard',
        },
      ];

      const result = reassignRoles(nodes);
      assert.strictEqual(result[0].role, 'entry');
    });

    it('does not mutate the original array', () => {
      const original = [
        {
          id: 'a',
          serverId: 1,
          label: 'A',
          role: 'middle' as const,
          protocol: 'wireguard' as const,
        },
      ];
      const result = reassignRoles(original);

      assert.strictEqual(original[0].role, 'middle');
      assert.strictEqual(result[0].role, 'entry');
    });
  });

  describe('getDefaultPositions', () => {
    it('returns positions keyed by node id', () => {
      const result = getDefaultPositions(3, 'linear');

      assert.strictEqual(Object.keys(result).length, 3);
      assert.ok(result['node-0']);
      assert.ok(result['node-1']);
      assert.ok(result['node-2']);
    });

    it('returns empty object for zero nodes', () => {
      const result = getDefaultPositions(0, 'linear');
      assert.strictEqual(Object.keys(result).length, 0);
    });
  });

  describe('generateNodeId', () => {
    it('produces unique ids across rapid calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateNodeId());
      }
      assert.strictEqual(ids.size, 100, 'All generated IDs should be unique');
    });

    it('prefixes with "node-"', () => {
      const id = generateNodeId();
      assert.ok(id.startsWith('node-'));
    });

    it('has reasonable length (8 hex chars after prefix)', () => {
      const id = generateNodeId();
      assert.strictEqual(id.length, 13); // "node-" + 8 chars
    });
  });
});
