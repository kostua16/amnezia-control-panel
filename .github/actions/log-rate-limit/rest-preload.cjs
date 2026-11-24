/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

try {
  const { channel } = require('node:diagnostics_channel');
  const { randomUUID } = require('node:crypto');
  const { appendFileSync, realpathSync } = require('node:fs');
  const { join } = require('node:path');

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
      if (target.prefix && !pathname.startsWith(`${target.prefix}/`))
        return null;
      pathname = pathname.slice(target.prefix.length);
    }
    if (pathname === '/graphql') return 'graphql';
    if (pathname === '/rate_limit' && method === 'GET') return null;
    const verb = METHODS.includes(method) ? method : 'OTHER';
    const route =
      MATCHERS.find(([, pattern]) => pattern.test(pathname))?.[0] ?? '/other';
    return `${verb} ${route}`;
  }

  function subscribe(dir, target) {
    const file = join(dir, `requests-${randomUUID()}.log`);
    function record(request) {
      const route = classify(request, target);
      if (route) appendFileSync(file, `${route}\n`, { mode: 0o600 });
    }
    // Subscribers must contain their own errors. Node can surface a thrown
    // diagnostics subscriber as an uncaught exception in the application.
    channel('http.client.request.start').subscribe((message) => {
      try {
        const { request } = message;
        record({
          origin: `${request.protocol}//${request.host}`,
          method: request.method,
          path: request.path,
        });
      } catch {
        // Best-effort telemetry.
      }
    });
    channel('undici:client:sendHeaders').subscribe((message) => {
      try {
        record(message.request);
      } catch {
        // Best-effort telemetry.
      }
    });
    try {
      appendFileSync(file, 'attached\n', { mode: 0o600 });
    } catch {
      // Still propagate the preload to children when the marker cannot be saved.
    }
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
  if (
    process.env.REST_COUNTER_DIR &&
    sameDirectory(process.env.REST_COUNTER_DIR, __dirname)
  ) {
    subscribe(__dirname, apiTarget(process.env.GITHUB_API_URL));
    // The current process loaded this file explicitly. Preserve inherited
    // options and add the preload only for any later Node subprocesses.
    const option = `--require "${__filename.replaceAll('\\', '\\\\')}"`;
    const existing = process.env.NODE_OPTIONS ?? '';
    if (!existing.endsWith(option)) {
      process.env.NODE_OPTIONS = existing ? `${existing} ${option}` : option;
    }
  }
} catch {
  // A failed preload must leave the application running normally.
}
