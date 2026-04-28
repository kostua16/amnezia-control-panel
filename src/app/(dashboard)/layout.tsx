import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { AuthGuard } from '@/components/auth-guard';

export default function DashboardRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardLayout>{children}</DashboardLayout>
    </AuthGuard>
  );
}
