import { NextResponse } from 'next/server';

/**
 * POST /api/services/awg/uninstall
 *
 * Placeholder endpoint for uninstalling the Amnezia AWG (WireGuard) service.
 * On a production Linux server, this would stop and remove the service.
 * Currently returns a success response for development and testing purposes.
 */
export async function POST() {
  try {
    // Placeholder: in production this would execute the AWG uninstallation
    // e.g. execFileSync('systemctl', ['stop', 'amnezia-awg'])
    //      execFileSync('systemctl', ['disable', 'amnezia-awg'])
    //
    // The actual uninstall process would:
    // 1. Stop the systemd service
    // 2. Disable the service from auto-start
    // 3. Remove configuration files and keys
    // 4. Clean up package files

    return NextResponse.json({
      success: true,
      message: 'Amnezia AWG uninstallation initiated (placeholder)',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to uninstall Amnezia AWG' },
      { status: 500 },
    );
  }
}
