// Next.js instrumentation hook. register() runs once on server startup.
// Node-only APIs (process.on / process.exit) live in instrumentation.node.ts
// and are loaded only when NEXT_RUNTIME === 'nodejs', so Edge static analysis
// never sees them. See:
// https://nextjs.org/docs/app/guides/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation.node');
    await registerNode();
  }
}
