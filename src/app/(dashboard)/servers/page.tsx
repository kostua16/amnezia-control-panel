import { ServerList } from '@/components/servers/server-list';

export default function ServersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Servers</h1>
        <p className="text-muted-foreground mt-1">
          VPN server management and connectivity
        </p>
      </div>
      <ServerList />
    </div>
  );
}
