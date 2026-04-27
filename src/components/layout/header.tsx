'use client';

import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="flex h-14 items-center border-b border-border bg-background px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Toggle menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <span className="ml-2 text-sm font-medium text-foreground lg:ml-0">
        Amnezia Control Panel
      </span>

      <div className="ml-auto">
        {/* Placeholder for future status indicators / user avatar */}
      </div>
    </header>
  );
}
