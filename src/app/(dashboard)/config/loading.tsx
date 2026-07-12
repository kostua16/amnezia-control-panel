import { SkeletonBar, SkeletonCard } from '@/components/ui/skeleton';

export default function ConfigLoading() {
  return (
    <div className="space-y-4 p-6">
      <SkeletonBar className="h-8 w-48" />

      {/* Config list */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}
