/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

try {
  const { channel } = require('node:diagnostics_channel');
  const { randomUUID } = require('node:crypto');
  const { appendFileSync } = require('node:fs');
  const { join } = require('node:path');

  const { classify, apiTarget, sameDirectory } = require('./rest-routes.cjs');

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
    // This internal Undici channel may change. If it stops emitting, fetch
    // goes uncounted while the separate Node HTTP(S) observer still works.
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
