import { NextRequest, NextResponse } from 'next/server';
import { importConfigs } from '@/lib/config-import';

/** Maximum upload file size in bytes (5 MB). */
const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    let data: unknown;

    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form data (file upload)
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          {
            success: false,
            error: 'No file provided. Send a JSON file as "file" field.',
          },
          { status: 422 },
        );
      }

      if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is ${MAX_IMPORT_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
          },
          { status: 413 },
        );
      }

      const text = await file.text();
      try {
        data = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid JSON file' },
          { status: 422 },
        );
      }
    } else {
      // Handle raw JSON body
      data = await request.json();
    }

    const report = await importConfigs(data);

    const hasErrors = report.errors.length > 0;

    return NextResponse.json(
      {
        success: true,
        data: report,
        message: hasErrors
          ? `Import completed with ${report.errors.length} errors`
          : 'Import completed successfully',
      },
      { status: hasErrors ? 207 : 200 },
    );
  } catch (err) {
    console.error('[api/configs/import] POST error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to import configurations' },
      { status: 500 },
    );
  }
}
