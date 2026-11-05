import { useState } from "react"
import { useCoverPreview } from "@/entrypoints/sidepanel/hooks/useCoverPreview"
import type { CoverPreviewIdentity } from "@/entrypoints/sidepanel/services/cover-preview-loader"
import { cn } from "@/src/shared/utils"

export function CoverPreview({
  identity,
  alt,
  className,
}: {
  identity?: CoverPreviewIdentity
  alt: string
  className?: string
}) {
  const preview = useCoverPreview(identity)
  const [failedUrl, setFailedUrl] = useState<string>()
  const ready = preview.status === "ready" && preview.url !== failedUrl
  const loading = preview.status === "loading"
  const src = ready ? preview.url : chrome.runtime.getURL("icon/128.png")

  return (
    <div
      className="relative h-full w-full"
      data-preview-state={loading ? "loading" : ready ? "ready" : "fallback"}
      aria-busy={loading}
    >
      <img
        src={src}
        alt={alt}
        className={cn("h-full w-full", loading && "opacity-0", className)}
        onError={() => {
          if (ready) setFailedUrl(src)
        }}
        draggable={false}
      />
      {loading && <div className="absolute inset-0 bg-muted" />}
    </div>
  )
}
