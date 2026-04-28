import { ServiceStatusDisplay } from '@/components/services/service-status';
import { ConfigurationDisplay } from '@/components/services/configuration-display';

export default function ServicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Services</h1>
        <p className="text-muted-foreground mt-1">
          VPN service management and configuration
        </p>
      </div>
      <ServiceStatusDisplay />
      <ConfigurationDisplay />
    </div>
  );
}
