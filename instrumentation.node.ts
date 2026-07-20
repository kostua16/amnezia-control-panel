// Node-only instrumentation. Dynamically imported from instrumentation.ts
// when NEXT_RUNTIME === 'nodejs' so Edge static analysis never sees
// process.on / process.exit.

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

export async function registerNode(): Promise<void> {
  const { startPanelHealthChecks, cleanup: cleanupPanelHealth } =
    await import('@/lib/panel-health-checker');
  startPanelHealthChecks();

  const { startBroadcaster, stopBroadcaster } =
    await import('@/lib/real-time-broadcaster');
  startBroadcaster();

  const { cleanupConnections } = await import('@/lib/server-connection');
  const { geoIPManager, cleanupGeoIP } = await import('@/lib/geoip-manager');

  // GeoIP init loads geoip.dat and builds the country trie so geo-routing
  // rules resolve correctly at runtime. Must run before any lookup call.
  geoIPManager
    .init()
    .catch((err) => console.error('[instrumentation] GeoIP init failed:', err));

  // Each cleanup function stops its own interval and clears its in-memory
  // state, so they are idempotent and safe to call together on shutdown.
  registerGracefulShutdown(async () => {
    cleanupPanelHealth();
    stopBroadcaster();
    cleanupConnections();
    cleanupGeoIP();

    // Close the WebSocket server so clients see a proper disconnect. The close
    // callback fires only after pending connections drain, so await it before
    // process exit to ensure clients receive disconnect packets. Bound the wait
    // at 3s (matching prisma.$disconnect) so a non-draining client cannot stall
    // graceful shutdown until the container's SIGKILL grace period.
    const socketIO = (globalThis as Record<string, unknown>).__socketIO as
      { close: (cb: () => void) => void } | undefined;
    if (socketIO) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3_000);
        socketIO.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // Await prisma disconnect with a 3s timeout so the SQLite WAL
    // checkpoint can complete before the container receives SIGKILL.
    const { prisma } = await import('@/lib/prisma');
    const disconnectWithTimeout = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3_000);
        prisma.$disconnect().finally(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    await disconnectWithTimeout();
  });
}
