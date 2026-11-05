export function SectionLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 ">
      <div className="flex flex-col gap-4">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-4 w-full bg-muted rounded" />
        <div className="h-4 w-3/4 bg-muted rounded" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="h-6 w-32 bg-muted rounded" />
        <div className="h-20 w-full bg-muted rounded" />
      </div>
    </div>
  )
}
