/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeTableCell, escapeBulletItem } = require('../md-escape.cjs');

test('escapeTableCell collapses all newline variants, escapes pipes, and neutralizes link brackets', () => {
  assert.equal(escapeTableCell('a|b'), 'a\\|b');
  assert.equal(escapeTableCell('line1\nline2'), 'line1 line2');
  assert.equal(escapeTableCell('line1\r\nline2'), 'line1 line2');
  assert.equal(escapeTableCell('line1\rline2'), 'line1 line2');
  assert.equal(escapeTableCell('[click](https://evil.example)'), '\\[click](https://evil.example)');
  assert.equal(escapeTableCell(null), '');
  assert.equal(escapeTableCell(undefined), '');
  assert.equal(escapeTableCell(42), '42');
  assert.equal(escapeTableCell(''), '');
});

test('escapeBulletItem collapses all newline variants and neutralizes link brackets', () => {
  assert.equal(escapeBulletItem('one\ntwo'), 'one two');
  assert.equal(escapeBulletItem('one\r\ntwo'), 'one two');
  assert.equal(escapeBulletItem('one\rtwo'), 'one two');
  assert.equal(escapeBulletItem('- nested\nmore'), '- nested more');
  assert.equal(escapeBulletItem('[click](https://evil.example)'), '\\[click](https://evil.example)');
  assert.equal(escapeBulletItem(null), '');
  assert.equal(escapeBulletItem(undefined), '');
  // Pipes pass through — not special in list context.
  assert.equal(escapeBulletItem('a|b'), 'a|b');
});
