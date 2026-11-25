/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { realpathSync } = require('node:fs');

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const REPO = '/repos/:o/:r';
// Emit only fixed templates. Even unfamiliar paths can contain sensitive data.
const ROUTES = [
  REPO,
  ...[
    '/actions/jobs/:id',
    '/actions/jobs/:id/logs',
    '/actions/runs',
    '/actions/runs/:id',
    '/actions/runs/:id/artifacts',
    '/actions/runs/:id/jobs',
    '/actions/runs/:id/logs',
    '/actions/runs/:id/rerun',
    '/actions/workflows',
    '/actions/workflows/:id/runs',
    '/actions/workflows/:id/dispatches',
    '/branches',
    '/branches/:ref',
    '/check-runs/:id',
    '/commits/:ref',
    '/commits/:ref/check-runs',
    '/commits/:ref/status',
    '/compare/:refs',
    '/contents/:path',
    '/git/refs/:ref',
    '/issues',
    '/issues/:n',
    '/issues/:n/comments',
    '/issues/:n/labels',
    '/issues/:n/labels/:name',
    '/issues/comments/:id',
    '/labels',
    '/pulls',
    '/pulls/:n',
    '/pulls/:n/commits',
    '/pulls/:n/files',
    '/pulls/:n/merge',
    '/pulls/:n/reviews',
    '/pulls/:n/comments',
    '/releases',
    '/statuses/:sha',
  ].map((suffix) => REPO + suffix),
  '/app',
  '/installation/repositories',
  '/search/issues',
  '/search/repositories',
  '/user',
  '/users/:login',
];
const MATCHERS = ROUTES.map((route) => {
  const pattern = route
    .replace(/\/git\/refs\/:ref$/, '/git/refs/.+')
    .replace(/:(?:path|refs)\b/g, '.+')
    .replace(/:\w+/g, '[^/]+');
  return [route, new RegExp(`^${pattern}$`)];
});

function apiTarget(apiUrl) {
  try {
    const url = new URL(apiUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        hostname: url.hostname,
        prefix: url.pathname.replace(/\/+$/, ''),
      };
    }
  } catch {
    // Public API matching is independent of the configured enterprise URL.
  }
  return {};
}

function classify({ origin, method, path }, target) {
  const { hostname } = new URL(origin);
  let pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  if (hostname !== 'api.github.com') {
    if (hostname !== target.hostname) return null;
    if (
      target.prefix.endsWith('/api/v3') &&
      pathname === `${target.prefix.slice(0, -3)}/graphql`
    )
      return 'graphql';
    if (target.prefix && !pathname.startsWith(`${target.prefix}/`)) return null;
    pathname = pathname.slice(target.prefix.length);
  }
  if (pathname === '/graphql') return 'graphql';
  // gh headline diagnostics omit the verb for quota probes.
  if (pathname === '/rate_limit' && (method === 'GET' || method === undefined))
    return null;
  const verb = METHODS.includes(method) ? method : 'OTHER';
  const route =
    MATCHERS.find(([, pattern]) => pattern.test(pathname))?.[0] ?? '/other';
  return `${verb} ${route}`;
}

function sameDirectory(left, right) {
  try {
    const a = realpathSync(left);
    const b = realpathSync(right);
    return process.platform === 'win32'
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;
  } catch {
    return false;
  }
}

module.exports = { METHODS, ROUTES, classify, apiTarget, sameDirectory };
