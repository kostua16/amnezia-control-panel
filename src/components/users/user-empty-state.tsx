import Link from 'next/link';
import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UserEmptyStateProps {
  hasSearch: boolean;
}

export function UserEmptyState({ hasSearch }: UserEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Users className="h-8 w-8 text-muted-foreground" />
      </div>

      {hasSearch ? (
        <>
          <h3 className="mt-4 text-lg font-semibold">No users match your search</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Try adjusting your search query.
          </p>
        </>
      ) : (
        <>
          <h3 className="mt-4 text-lg font-semibold">No users yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first VPN user to get started.
          </p>
          <Link href="/users/create" className="mt-6">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create User
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}
