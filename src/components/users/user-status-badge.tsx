import { clsx } from 'clsx';

type UserStatus = 'active' | 'blocked' | 'inactive';

function getUserStatus(isActive: boolean, isBlocked: boolean): UserStatus {
  if (isBlocked) return 'blocked';
  if (!isActive) return 'inactive';
  return 'active';
}

const statusConfig: Record<
  UserStatus,
  { label: string; dotColor: string; badgeClass: string }
> = {
  active: {
    label: 'Active',
    dotColor: 'bg-green-500',
    badgeClass: 'bg-green-500/10 text-green-500',
  },
  blocked: {
    label: 'Blocked',
    dotColor: 'bg-red-500',
    badgeClass: 'bg-red-500/10 text-red-500',
  },
  inactive: {
    label: 'Inactive',
    dotColor: 'bg-muted-foreground',
    badgeClass: 'bg-muted text-muted-foreground',
  },
};

interface UserStatusBadgeProps {
  isActive: boolean;
  isBlocked: boolean;
}

export function UserStatusBadge({ isActive, isBlocked }: UserStatusBadgeProps) {
  const status = getUserStatus(isActive, isBlocked);
  const config = statusConfig[status];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        config.badgeClass,
      )}
    >
      <span className={clsx('h-2 w-2 rounded-full', config.dotColor)} />
      {config.label}
    </span>
  );
}
