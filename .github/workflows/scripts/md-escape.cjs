'use strict';

// Shared markdown sanitization helpers for workflow scripts.
//
// External contributor-controlled data (PR titles, branch names, agent output)
// cannot be emitted verbatim into markdown tables or lists — newlines split
// rows, pipes split columns, and bracket-shaped values render as clickable
// links. These helpers ensure consistent, defense-in-depth sanitization
// across all digest and report scripts.

/**
 * Sanitize a value for safe inclusion in a markdown table cell.
 * Collapses all newline variants, escapes pipe characters, and
 * backslash-escapes opening brackets to prevent markdown link rendering.
 *
 * @param {*} value - The value to sanitize.
 * @returns {string} The sanitized string.
 */
function escapeTableCell(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[');
}

/**
 * Sanitize a value for safe inclusion in a markdown bullet list item.
 * Collapses all newline variants and escapes opening brackets.
 * Pipes are not special in list context, so they pass through.
 *
 * @param {*} value - The value to sanitize.
 * @returns {string} The sanitized string.
 */
function escapeBulletItem(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\[/g, '\\[');
}

module.exports = { escapeTableCell, escapeBulletItem };
