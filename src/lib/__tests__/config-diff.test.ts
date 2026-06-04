import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDiffForDisplay } from '../config-diff';
import type { ConfigDiffSection } from '@/types/config-push';

describe('formatDiffForDisplay', () => {
  it('formats an empty sections array as empty string', () => {
    const result = formatDiffForDisplay([]);
    assert.strictEqual(result, '');
  });

  it('formats a single section with header and line prefixes', () => {
    const sections: ConfigDiffSection[] = [
      {
        label: 'Chain Nodes',
        lines: [
          { type: 'added', content: 'entry wireguard: vpn1 (1.2.3.4:51820)' },
          {
            type: 'unchanged',
            content: 'exit wireguard: vpn2 (5.6.7.8:51820)',
          },
          {
            type: 'removed',
            content: 'middle wireguard: vpn3 (9.10.11.12:51820)',
          },
        ],
        summary: { added: 1, removed: 1, unchanged: 1 },
      },
    ];

    const result = formatDiffForDisplay(sections);
    const lines = result.split('\n');

    assert.ok(lines[0].includes('Chain Nodes'));
    assert.ok(lines[0].includes('+1'));
    assert.ok(lines[0].includes('-1'));
    assert.ok(lines[0].includes('1 unchanged'));

    assert.ok(lines[1].startsWith('  + '));
    assert.ok(lines[1].includes('entry wireguard'));

    assert.ok(lines[2].startsWith('   '));
    assert.ok(lines[2].includes('exit wireguard'));

    assert.ok(lines[3].startsWith('  - '));
    assert.ok(lines[3].includes('middle wireguard'));
  });

  it('formats multiple sections separated by blank lines', () => {
    const sections: ConfigDiffSection[] = [
      {
        label: 'Section A',
        lines: [{ type: 'added', content: 'item-a' }],
        summary: { added: 1, removed: 0, unchanged: 0 },
      },
      {
        label: 'Section B',
        lines: [{ type: 'removed', content: 'item-b' }],
        summary: { added: 0, removed: 1, unchanged: 0 },
      },
    ];

    const result = formatDiffForDisplay(sections);
    // Sections are separated by a blank line (added by the trailing '' push)
    assert.ok(result.includes('Section A'));
    assert.ok(result.includes('Section B'));
    // Verify there's at least one blank line between sections
    assert.ok(result.includes('\n\n'));
  });

  it('shows zero counts in header when no changes', () => {
    const sections: ConfigDiffSection[] = [
      {
        label: 'WireGuard Peers',
        lines: [{ type: 'unchanged', content: 'peer abc' }],
        summary: { added: 0, removed: 0, unchanged: 1 },
      },
    ];

    const result = formatDiffForDisplay(sections);
    assert.ok(result.includes('+0'));
    assert.ok(result.includes('-0'));
    assert.ok(result.includes('1 unchanged'));
  });
});
