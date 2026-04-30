export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPanelHealthChecks } = await import('@/lib/panel-health-checker');
    startPanelHealthChecks();
  }
}
