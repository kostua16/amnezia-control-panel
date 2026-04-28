'use client';

import { Wifi, Globe, Settings, Network } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

interface ConfigEntry {
  label: string;
  value: string;
}

interface ConfigSection {
  title: string;
  icon: React.ReactNode;
  entries: ConfigEntry[];
}

/**
 * Placeholder VPN configuration data.
 * In production, this would be fetched from actual config files
 * or the Amnezia/3x-ui APIs.
 */
const AWG_CONFIG: ConfigEntry[] = [
  { label: 'Interface', value: 'wg0' },
  { label: 'Listen Port', value: '51820' },
  { label: 'Private Key', value: '***' },
  { label: 'Public Key', value: '***' },
  { label: 'Address', value: '10.8.0.1/24' },
  { label: 'DNS', value: '1.1.1.1, 8.8.8.8' },
  { label: 'MTU', value: '1420' },
  { label: 'Persistent Keepalive', value: '25' },
];

const XUI_CONFIG: ConfigEntry[] = [
  { label: 'Panel Address', value: '0.0.0.0' },
  { label: 'Panel Port', value: '2053' },
  { label: 'Web Base Path', value: '/' },
  { label: 'Xray Executable', value: '/usr/local/x-ui/bin/xray-linux-amd64' },
  { label: 'Inbound Protocols', value: 'VLESS, VMess, Trojan' },
  { label: 'Default DNS', value: '1.1.1.1, 8.8.8.8' },
  { label: 'Log Level', value: 'warning' },
];

const configSections: ConfigSection[] = [
  {
    title: 'Amnezia AWG (WireGuard)',
    icon: <Wifi className="h-5 w-5" />,
    entries: AWG_CONFIG,
  },
  {
    title: '3x-ui (Xray Panel)',
    icon: <Globe className="h-5 w-5" />,
    entries: XUI_CONFIG,
  },
];

function ConfigCard({ section }: { section: ConfigSection }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {section.icon}
          {section.title}
        </CardTitle>
        <CardDescription>
          Current configuration parameters
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {section.entries.map((entry) => (
            <div
              key={entry.label}
              className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0"
            >
              <span className="text-sm text-muted-foreground">
                {entry.label}
              </span>
              <span className="font-mono text-sm">{entry.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ConfigurationDisplay() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">VPN Configuration</h2>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {configSections.map((section) => (
          <ConfigCard key={section.title} section={section} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-5 w-5" />
            Network Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Configuration is loaded from local service config files. In a
            production deployment, values are read directly from Amnezia AWG and
            3x-ui configuration files on the server.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
