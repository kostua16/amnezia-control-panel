import { SkeletonBar } from '@/components/ui/skeleton';

export default function UsersLoading() {
  return (
    <div className="space-y-4 p-6">
      <SkeletonBar className="h-8 w-48" />

      {/* Table header */}
      <div className="flex items-center gap-4 px-4 py-3">
        <SkeletonBar className="h-3 w-[30%]" />
        <SkeletonBar className="h-3 w-[15%]" />
        <SkeletonBar className="h-3 w-[25%]" />
        <SkeletonBar className="h-3 w-[15%]" />
        <SkeletonBar className="h-3 w-[15%]" />
      </div>

      {/* Table rows */}
      {Array.from({ length: 8 }).map((_, i) => (
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
