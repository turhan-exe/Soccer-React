import { Skeleton } from "@/components/ui/skeleton";

export const PlayerCardSkeleton = () => (
  <div className="bg-card border rounded-xl p-4 space-y-3">
    <div className="flex items-center gap-3">
      <Skeleton className="w-12 h-12 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
    </div>
    <div className="space-y-2">
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-2 w-3/4" />
      <Skeleton className="h-2 w-1/2" />
    </div>
  </div>
);

export const MatchCardSkeleton = () => (
  <div className="bg-card border rounded-xl p-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Skeleton className="w-8 h-8 rounded" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="text-right space-y-1">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-3 w-8" />
      </div>
    </div>
  </div>
);

export const TableRowSkeleton = () => (
  <div className="flex items-center justify-between py-2 border-b">
    <div className="flex items-center gap-2">
      <Skeleton className="w-6 h-6 rounded" />
      <Skeleton className="h-4 w-24" />
    </div>
    <div className="flex gap-4">
      <Skeleton className="h-4 w-8" />
      <Skeleton className="h-4 w-8" />
      <Skeleton className="h-4 w-8" />
    </div>
  </div>
);