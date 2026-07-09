import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateWireGuardPeers,
  generateXrayRoutingRules,
} from '../chain-config-generator';
import type { ChainTemplate, ChainNode } from '@/types/chain';

type Resolved = ChainNode & { hostname: string; port: number };

const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

function node(
  partial: Partial<Resolved> & Pick<Resolved, 'label' | 'role'>,
): Resolved {
  return {
    serverId: 0,
    protocol: 'wireguard',
    hostname: `${partial.label.replace(/\s+/g, '').toLowerCase()}.ts.net`,
    port: 51820,
    ...partial,
  };
}

describe('generateWireGuardPeers', () => {
  it('linear: bidirectional peers between consecutive hops', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'linear',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'Entry', role: 'entry' }),
      node({ label: 'Exit', role: 'exit' }),
    ];

    const peers = generateWireGuardPeers(template, nodes);

    // 2 hops-worth of bidirectional peers: 2*(N-1) = 2.
    assert.equal(peers.length, 2);
    assert.deepEqual(peers.map((p) => p.nodeId).sort(), ['Entry', 'Exit']);
    // Forward peer carries the full-tunnel allowed IPs.
    assert.ok(peers.some((p) => p.allowedIPs === '0.0.0.0/0'));
    // All peers have real WireGuard public keys (no STUB_ prefix).
    for (const p of peers) {
      assert.ok(
        WG_KEY_RE.test(p.publicKey),
        `linear peer ${p.nodeId} publicKey is not a valid WG key: ${p.publicKey}`,
      );
      assert.ok(
        !('privateKey' in p),
        `linear peer ${p.nodeId} leaked privateKey`,
      );
    }
  });

  it('split: only the foreign node gets a peer', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'split',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'Domestic (Direct)', role: 'domestic' }),
      node({ label: 'Foreign (VPN)', role: 'foreign' }),
    ];

    const peers = generateWireGuardPeers(template, nodes);

    assert.equal(peers.length, 1);
    assert.equal(peers[0].nodeId, 'Foreign (VPN)');
    assert.ok(
      WG_KEY_RE.test(peers[0].publicKey),
      'split peer publicKey is not a valid WG key',
    );
    assert.ok(!('privateKey' in peers[0]), 'split peer leaked privateKey');
  });

  it('mesh: fully meshed directed peers', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'mesh',
      requiredServers: 3,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'A', role: 'entry' }),
      node({ label: 'B', role: 'middle' }),
      node({ label: 'C', role: 'middle' }),
    ];

    const peers = generateWireGuardPeers(template, nodes);

    // N*(N-1) directed peers for 3 nodes.
    assert.equal(peers.length, 6);
    // All mesh peers have real WireGuard keys.
    for (const p of peers) {
      assert.ok(
        WG_KEY_RE.test(p.publicKey),
        `mesh peer ${p.nodeId} publicKey is not a valid WG key: ${p.publicKey}`,
      );
      assert.ok(
        !('privateKey' in p),
        `mesh peer ${p.nodeId} leaked privateKey`,
      );
    }
  });

  it('produces stable peer keys for repeated generation', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'linear',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'Entry', role: 'entry', serverId: 1 }),
      node({ label: 'Exit', role: 'exit', serverId: 2 }),
    ];

    assert.deepEqual(
      generateWireGuardPeers(template, nodes),
      generateWireGuardPeers(template, nodes),
    );
  });
});

describe('generateXrayRoutingRules — canonical behavior', () => {
  it('linear: per-hop ascending priority plus exit direct rule', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'linear',
      requiredServers: 3,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'Entry', role: 'entry' }),
      node({ label: 'Middle', role: 'middle' }),
      node({ label: 'Exit', role: 'exit' }),
    ];

    const rules = generateXrayRoutingRules(template, nodes);

    // Each hop emits a chain rule + a 10.0.0.0/8 direct rule (2*2 = 4),
    // plus the catch-all exit direct rule = 5.
    assert.equal(rules.length, 5);
    // Priorities must vary per hop (0,1 then 10,11) — not a flat 0.
    const priorities = new Set(rules.map((r) => r.priority));
    assert.ok(priorities.size > 1, 'linear priorities should vary per hop');
    // Exit catch-all direct rule is present.
    assert.ok(
      rules.some((r) => r.nodeId === 'Exit' && r.outboundTag === 'direct'),
    );
  });

  it('split: domestic geoip-aware, foreign exits direct', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'split',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'Domestic (Direct)', role: 'domestic' }),
      node({ label: 'Foreign (VPN)', role: 'foreign' }),
    ];

    const rules = generateXrayRoutingRules(template, nodes, {
      split: { directGeoipTags: ['kz'] },
    });

    assert.equal(rules.length, 4);
    const domesticRules = rules.filter((r) => r.nodeId === 'Domestic (Direct)');
    assert.ok(
      domesticRules.some((r) => r.type === 'geoip' && r.value === 'kz'),
    );
    assert.ok(
      domesticRules.some((r) => r.type === 'geoip' && r.value === 'private'),
    );
    assert.ok(!rules.some((r) => r.type === 'geoip' && r.value === 'ru'));
    assert.ok(
      domesticRules.some((r) => r.outboundTag === 'chain_Foreign_(VPN)'),
    );
    assert.ok(
      rules.some(
        (r) => r.nodeId === 'Foreign (VPN)' && r.outboundTag === 'direct',
      ),
    );
  });

  it('split: multiple direct zones use deterministic priorities', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'split',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'Domestic (Direct)', role: 'domestic' }),
      node({ label: 'Foreign (VPN)', role: 'foreign' }),
    ];

    const rules = generateXrayRoutingRules(template, nodes, {
      split: { directGeoipTags: ['KZ', 'de', 'kz'] },
    });

    assert.deepEqual(
      rules
        .filter((r) => r.nodeId === 'Domestic (Direct)')
        .map((r) => [r.type, r.value, r.priority]),
      [
        ['geoip', 'kz', 0],
        ['geoip', 'de', 1],
        ['geoip', 'private', 2],
        ['ip', '0.0.0.0/0', 12],
      ],
    );
  });

  it('split: rejects invalid direct zone tags', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'split',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'Domestic (Direct)', role: 'domestic' }),
      node({ label: 'Foreign (VPN)', role: 'foreign' }),
    ];

    assert.throws(
      () =>
        generateXrayRoutingRules(template, nodes, {
          split: { directGeoipTags: ['kz', 'r u'] },
        }),
      /Invalid split GeoIP zone tag: r u/,
    );
  });

  it('mesh: routes through mesh_balancer with inter-node direct', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'mesh',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };
    const nodes = [
      node({ label: 'A', role: 'entry' }),
      node({ label: 'B', role: 'middle' }),
    ];

    const rules = generateXrayRoutingRules(template, nodes);

    // 2 rules per node (balancer + inter-node direct) = 4.
    assert.equal(rules.length, 4);
    assert.ok(
      rules.every(
        (r) => r.outboundTag !== 'direct' || r.value === '10.0.0.0/8',
      ),
    );
    assert.ok(
      rules.some((r) => r.outboundTag === 'mesh_balancer'),
      'mesh rules must use the mesh_balancer outbound, not a flat direct',
    );
  });
});

describe('chain-config-generator — preview/apply parity', () => {
  // The apply path (chain-router) and the push-wizard preview path both feed
  // resolved nodes into the shared generator. The apply path passes
  // ChainNode-shaped nodes; the preview path spreads extra RemotePanel fields.
  // Because the generator reads only label/role/hostname/port, both inputs
  // must produce identical output — this is the drift the dedup eliminates.
  it('produces identical output regardless of extra fields on the node', () => {
    const template: ChainTemplate = {
      id: 't',
      name: 't',
      description: '',
      topology: 'split',
      requiredServers: 2,
      nodes: [],
      icon: '',
    };

    const applyShape: Resolved[] = [
      node({ label: 'Domestic (Direct)', role: 'domestic' }),
      node({ label: 'Foreign (VPN)', role: 'foreign' }),
    ];
    const previewShape = applyShape.map((n) => ({
      ...n,
      // Extra fields the preview path attaches from RemotePanel rows.
      panelName: `panel-${n.label}`,
      isActive: true,
    }));

    const applyPeers = generateWireGuardPeers(template, applyShape);
    const previewPeers = generateWireGuardPeers(template, previewShape);
    assert.deepEqual(applyPeers, previewPeers);
    for (let i = 0; i < applyPeers.length; i++) {
      assert.ok(WG_KEY_RE.test(applyPeers[i].publicKey));
      assert.ok(!('privateKey' in applyPeers[i]));
    }

    assert.deepEqual(
      generateXrayRoutingRules(template, applyShape, {
        split: { directGeoipTags: ['kz'] },
      }),
      generateXrayRoutingRules(template, previewShape, {
        split: { directGeoipTags: ['kz'] },
      }),
    );
  });
});
