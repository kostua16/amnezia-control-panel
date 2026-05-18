'use client';

import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const sizeConfig = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function LoadingSpinner({
  size = 'md',
  className,
  label,
}: LoadingSpinnerProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-3',
        className,
      )}
    >
      <Loader2
        className={clsx('animate-spin text-accent', sizeConfig[size])}
        aria-hidden="true"
      />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

/**
 * Full-page loading spinner for route transitions.
 */
export function PageLoader() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <LoadingSpinner size="lg" label="Loading..." />
    </div>
  );
}
