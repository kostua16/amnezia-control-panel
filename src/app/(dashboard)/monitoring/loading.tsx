import { SkeletonCard } from '@/components/ui/skeleton';

export default function MonitoringLoading() {
  return (
    <div className="space-y-6 p-6">
      {/* Resource cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} className="h-24" />
        ))}
      </div>

      {/* Charts */}
      <SkeletonCard className="h-64" />
    </div>
  );
}
