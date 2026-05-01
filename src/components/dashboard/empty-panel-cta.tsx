'use client';

import { Monitor } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function EmptyPanelCTA() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <Monitor className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">
          No Remote Panels
        </h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Add a remote panel to see its status, traffic, and alerts alongside
          your central panel&apos;s metrics.
        </p>
        <Link href="/panels">
          <Button className="mt-6">Add Your First Panel</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
