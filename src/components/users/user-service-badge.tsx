import { clsx } from 'clsx';
import type { ServiceType } from '@/generated/prisma/enums';

const serviceConfig: Record<
  string,
  { label: string; badgeClass: string }
> = {
  AWG: {
    label: 'AWG',
    badgeClass: 'bg-blue-500/15 text-blue-400',
  },
  THREE_XUI: {
    label: '3x-ui',
    badgeClass: 'bg-purple-500/15 text-purple-400',
  },
};

interface UserServiceBadgeProps {
  assignedServices: ServiceType[];
}

export function UserServiceBadge({ assignedServices }: UserServiceBadgeProps) {
  if (assignedServices.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">-</span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {assignedServices.map((serviceType) => {
        const config = serviceConfig[serviceType];
        if (!config) return null;

        return (
          <span
            key={serviceType}
            className={clsx(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              config.badgeClass,
            )}
          >
            {config.label}
          </span>
        );
      })}
    </div>
  );
}
