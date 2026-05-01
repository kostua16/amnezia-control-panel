import {
  LayoutDashboard,
  Users,
  Server,
  Monitor,
  Settings,
  Activity,
  Shield,
  SlidersHorizontal,
  LayoutTemplate,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Users', href: '/users', icon: Users },
  { label: 'Services', href: '/services', icon: Shield },
  { label: 'Config', href: '/config', icon: SlidersHorizontal },
  { label: 'Templates', href: '/templates', icon: LayoutTemplate },
  { label: 'Monitoring', href: '/monitoring', icon: Activity },
  { label: 'Servers', href: '/servers', icon: Server },
  { label: 'Panels', href: '/panels', icon: Monitor },
  { label: 'Settings', href: '/settings', icon: Settings },
];
