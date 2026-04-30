'use client';

import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateStarterProps {
  onLoadStarter: () => void;
  onCreateCustom: () => void;
  loading?: boolean;
}

export function EmptyStateStarter({ onLoadStarter, onCreateCustom, loading = false }: EmptyStateStarterProps) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Globe className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">
        No routing rules yet
      </h3>
      <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
        Get started with recommended starter rules, or create your own custom routing rules.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button onClick={onLoadStarter} disabled={loading}>
          Load Starter Rules
        </Button>
        <Button variant="outline" onClick={onCreateCustom}>
          Create Custom Rule
        </Button>
      </div>
    </div>
  );
}
