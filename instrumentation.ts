// Next.js instrumentation hook. register() runs once on server startup, inside
// the Next.js Node runtime where @/lib/* imports resolve. It is the correct
// place to start background jobs and to wire SIGTERM/SIGINT graceful shutdown:
// the custom server.mjs is plain Node and cannot import the TS lib sources.

/** Guards against registering duplicate shutdown listeners. */
let shutdownListenersRegistered = false;
/** Guards against running cleanup twice when both SIGTERM and SIGINT arrive. */
let shutdownStarted = false;

/**
 * Run cleanup once on SIGTERM/SIGINT, then exit. Listeners are registered
 * inside register() so the lib imports resolve through Next.js's loader.
 */
function registerGracefulShutdown(
  runCleanup: () => void | Promise<void>,
): void {
  if (shutdownListenersRegistered) return;
  shutdownListenersRegistered = true;

  const handle = (signal: NodeJS.Signals) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    console.log(`[instrumentation] Received ${signal}, cleaning up...`);
    Promise.resolve(runCleanup())
      .catch((err) =>
        console.error('[instrumentation] Graceful shutdown error:', err),
      )
      .finally(() => {
        console.log('[instrumentation] Graceful shutdown complete');
        process.exit(0);
      });
  };

  process.on('SIGTERM', () => handle('SIGTERM'));
  process.on('SIGINT', () => handle('SIGINT'));
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startPanelHealthChecks, cleanup: cleanupPanelHealth } =
    await import('@/lib/panel-health-checker');
  startPanelHealthChecks();

  const { startBroadcaster, stopBroadcaster } =
    await import('@/lib/real-time-broadcaster');
  startBroadcaster();

  const { cleanupConnections } = await import('@/lib/server-connection');
  const { cleanupGeoIP } = await import('@/lib/geoip-manager');

  // Each cleanup function stops its own interval and clears its in-memory
  // state, so they are idempotent and safe to call together on shutdown.
  registerGracefulShutdown(() => {
    cleanupPanelHealth();
    stopBroadcaster();
    cleanupConnections();
    cleanupGeoIP();
  });
}
