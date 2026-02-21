import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('skeleton', className)} />
}

export function WorkflowCardSkeleton() {
  return (
    <div className="card p-5 space-y-4 pointer-events-none">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      {/* Title */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      {/* Price + fields */}
      <div className="flex items-center gap-3 pt-2">
        <Skeleton className="h-7 w-20 rounded-lg" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/* Bottom bar */}
      <div className="border-t border-white/[0.06] pt-3 flex justify-between">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3.5 w-16" />
      </div>
    </div>
  )
}

export function WorkflowDetailSkeleton() {
  return (
    <div className="space-y-6 page-enter">
      <Skeleton className="h-6 w-32 rounded-full" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-3/4" />
      <div className="grid grid-cols-3 gap-4 pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}
