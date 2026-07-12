import { SkeletonCard } from '@/components/ui/skeleton';

export default function PanelsLoading() {
  return (
    <div className="space-y-4 p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} className="h-36" />
        ))}
      </div>
    </div>
  );
}
