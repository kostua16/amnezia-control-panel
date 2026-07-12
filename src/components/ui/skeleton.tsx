function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={`h-4 animate-pulse rounded bg-muted ${className ?? ''}`} />
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg border bg-card p-6 ${className ?? ''}`}
    >
      <SkeletonBar className="mb-4 h-5 w-1/3" />
      <SkeletonBar className="mb-2 h-4 w-full" />
      <SkeletonBar className="h-4 w-2/3" />
    </div>
  );
}

export { SkeletonBar, SkeletonCard };
