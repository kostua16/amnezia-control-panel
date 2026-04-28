import { UserList } from '@/components/users/user-list';

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Users</h1>
        <p className="text-muted-foreground mt-1">
          VPN user management and monitoring
        </p>
      </div>
      <UserList />
    </div>
  );
}
