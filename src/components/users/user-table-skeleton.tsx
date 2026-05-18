function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={`h-4 animate-pulse rounded bg-muted ${className ?? ''}`} />
  );
}

export function UserTableSkeleton() {
  return (
    <div className="space-y-3">
      {/* Header skeleton */}
      <div className="flex items-center gap-4 px-4 py-3">
        <SkeletonBar className="h-3 w-[30%]" />
        <SkeletonBar className="h-3 w-[15%]" />
        <SkeletonBar className="h-3 w-[25%]" />
        <SkeletonBar className="h-3 w-[15%]" />
        <SkeletonBar className="h-3 w-[15%]" />
      </div>

      {/* Data rows */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <SkeletonBar className="h-4 w-[30%]" />
          <SkeletonBar className="h-4 w-[15%]" />
          <SkeletonBar className="h-4 w-[25%]" />
          <SkeletonBar className="h-4 w-[15%]" />
          <div className="flex w-[15%] gap-2">
            <SkeletonBar className="h-8 w-8 rounded-full" />
            <SkeletonBar className="h-8 w-8 rounded-full" />
            <SkeletonBar className="h-8 w-8 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
