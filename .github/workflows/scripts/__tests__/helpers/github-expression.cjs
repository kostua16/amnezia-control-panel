// Minimal evaluator for the GitHub Actions expression subset used in workflow
// `concurrency` and `if:` keys, so tests can check what a real event payload
// resolves to instead of only pinning the expression text. Supported: string,
// number, boolean and null literals; context paths (`github.event.x`,
// `a[0]`); `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, parentheses;
// functions format, contains, startsWith, endsWith, toJSON, always,
// cancelled, success, failure. Semantics follow the GitHub docs: `&&`/`||`
// return operands, strings compare case-insensitively, missing properties
// are null.

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      let value = '';
      i++;
      while (i < source.length) {
        if (source[i] === "'" && source[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (source[i] === "'") {
          break;
        } else {
          value += source[i++];
        }
      }
      if (source[i] !== "'") throw new Error('Unterminated string literal');
      i++;
      tokens.push({ type: 'string', value });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['==', '!=', '&&', '||', '<=', '>='].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('()[].,!<>'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    const number = source.slice(i).match(/^-?\d+(\.\d+)?/);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const ident = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_-]*/);
    if (ident) {
      tokens.push({ type: 'ident', value: ident[0] });
      i += ident[0].length;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' in expression: ${source}`);
  }
  return tokens;
}

function truthy(value) {
  return !(
    value === null ||
    value === undefined ||
    value === false ||
    value === 0 ||
    value === '' ||
    Number.isNaN(value)
  );
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim() === '' ? 0 : Number(value);
  return NaN;
}

function looseEqual(a, b) {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  if ((a ?? null) === null && (b ?? null) === null) return true;
  if (typeof a === 'object' || typeof b === 'object') return a === b;
  return toNumber(a) === toNumber(b);
}

function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function callFunction(name, args, status) {
  switch (name.toLowerCase()) {
    case 'format':
      return asText(args[0]).replace(/\{(\d+)\}/g, (_, n) =>
        asText(args[Number(n) + 1]),
      );
    case 'contains':
      if (Array.isArray(args[0])) {
        return args[0].some((item) => looseEqual(item, args[1]));
      }
      return asText(args[0])
        .toLowerCase()
        .includes(asText(args[1]).toLowerCase());
    case 'startswith':
      return asText(args[0])
        .toLowerCase()
        .startsWith(asText(args[1]).toLowerCase());
    case 'endswith':
      return asText(args[0])
        .toLowerCase()
        .endsWith(asText(args[1]).toLowerCase());
    case 'tojson':
      return JSON.stringify(args[0] ?? null);
    case 'always':
      return true;
    case 'cancelled':
      return status === 'cancelled';
    case 'success':
      return status === 'success';
    case 'failure':
      return status === 'failure';
    default:
      throw new Error(`Unsupported function ${name}`);
  }
}

function evaluateExpression(source, context = {}, { status = 'success' } = {}) {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value) => peek()?.type === 'op' && peek().value === value;
  const expect = (value) => {
    if (!isOp(value)) throw new Error(`Expected '${value}' in ${source}`);
    pos++;
  };

  function parseOr() {
    let left = parseAnd();
    while (isOp('||')) {
      pos++;
      const right = parseAnd();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  function parseAnd() {
    let left = parseEquality();
    while (isOp('&&')) {
      pos++;
      const right = parseEquality();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function parseEquality() {
    let left = parseRelational();
    while (isOp('==') || isOp('!=')) {
      const op = tokens[pos++].value;
      const right = parseRelational();
      left = op === '==' ? looseEqual(left, right) : !looseEqual(left, right);
    }
    return left;
  }
  function parseRelational() {
    let left = parseUnary();
    while (isOp('<') || isOp('<=') || isOp('>') || isOp('>=')) {
      const op = tokens[pos++].value;
      const a = toNumber(left);
      const b = toNumber(parseUnary());
      left =
        op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
    }
    return left;
  }
  function parseUnary() {
    if (isOp('!')) {
      pos++;
      return !truthy(parseUnary());
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const token = tokens[pos++];
    if (!token) throw new Error(`Unexpected end of expression: ${source}`);
    if (token.type === 'string' || token.type === 'number') return token.value;
    if (token.type === 'op' && token.value === '(') {
      const value = parseOr();
      expect(')');
      return value;
    }
    if (token.type !== 'ident') {
      throw new Error(`Unexpected token '${token.value}' in ${source}`);
    }
    if (token.value === 'true') return true;
    if (token.value === 'false') return false;
    if (token.value === 'null') return null;
    if (isOp('(')) {
      pos++;
      const args = [];
      if (!isOp(')')) {
        args.push(parseOr());
        while (isOp(',')) {
          pos++;
          args.push(parseOr());
        }
      }
      expect(')');
      return callFunction(token.value, args, status);
    }
    let value = context[token.value] ?? null;
    for (;;) {
      if (isOp('.')) {
        pos++;
        const name = tokens[pos++];
        value =
          value === null || typeof value !== 'object'
            ? null
            : (value[name.value] ?? null);
      } else if (isOp('[')) {
        pos++;
        const key = parseOr();
        expect(']');
        value =
          value === null || typeof value !== 'object'
            ? null
            : (value[key] ?? null);
      } else {
        return value;
      }
    }
  }

  const result = parseOr();
  if (pos !== tokens.length) {
    throw new Error(`Trailing tokens in expression: ${source}`);
  }
  return result;
}

// Renders a workflow string that may contain `${{ ... }}` blocks.
function renderTemplate(template, context = {}, options = {}) {
  return String(template).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expr) =>
    asText(evaluateExpression(expr, context, options)),
  );
}

// `if:` keys may omit the `${{ }}` wrapper.
function evaluateCondition(condition, context = {}, options = {}) {
  const text = String(condition).trim();
  const match = text.match(/^\$\{\{([\s\S]*)\}\}$/);
  return truthy(evaluateExpression(match ? match[1] : text, context, options));
}

module.exports = {
  evaluateExpression,
  evaluateCondition,
  renderTemplate,
  truthy,
};
