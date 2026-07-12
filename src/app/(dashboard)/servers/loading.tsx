import { SkeletonCard } from '@/components/ui/skeleton';

export default function ServersLoading() {
  return (
    <div className="space-y-4 p-6">
      {/* Server cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}
