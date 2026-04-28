import { NextResponse } from 'next/server';

/**
 * POST /api/services/3x-ui/uninstall
 *
 * Placeholder endpoint for uninstalling the 3x-ui (Xray panel) service.
 * On a production Linux server, this would stop and remove the service.
 * Currently returns a success response for development and testing purposes.
 */
export async function POST() {
  try {
    // Placeholder: in production this would execute the 3x-ui uninstallation
    // e.g. execFileSync('systemctl', ['stop', '3x-ui'])
    //      execFileSync('systemctl', ['disable', '3x-ui'])
    //
    // The actual uninstall process would:
    // 1. Stop the systemd service
    // 2. Disable the service from auto-start
    // 3. Remove Xray core and panel files
    // 4. Clean up database and configuration

    return NextResponse.json({
      success: true,
      message: '3x-ui uninstallation initiated (placeholder)',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to uninstall 3x-ui' },
      { status: 500 },
    );
  }
}
