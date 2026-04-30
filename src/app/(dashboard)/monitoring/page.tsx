import { RoutingRulesTabs } from '@/components/routing/routing-rules-tabs';

export default function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Routing Rules</h1>
        <p className="text-muted-foreground mt-1">
          Manage geo-routing, IP/domain rules, and templates
        </p>
      </div>

      <RoutingRulesTabs />
    </div>
  );
}
