import { RoutingRulesList } from '@/components/routing/routing-rules-list';

export default function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Monitoring</h1>
        <p className="text-muted-foreground mt-1">
          Traffic monitoring and routing rules management
        </p>
      </div>

      <RoutingRulesList />
    </div>
  );
}
