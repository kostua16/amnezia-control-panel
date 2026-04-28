'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/auth-store';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

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

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4" />
          <span className="ml-2 hidden sm:inline">Log out</span>
        </Button>
      </div>
    </header>
  );
}
