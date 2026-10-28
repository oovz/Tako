import { useEffect, useState } from "react"
import { loadDownloadRootHandle } from "@/src/storage/fs-access"
import type { TaskDestination } from "@/src/types/state-snapshots"
import { t } from "@/src/runtime/i18n"

export function TaskDestinationCaption({
  destination,
  requestedPath,
  useChromeFallback,
}: {
  useChromeFallback?: true
  destination: TaskDestination
  requestedPath?: string | null
}) {
  const handleId =
    destination.kind === "file-system-access" ? destination.handleId : null
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(
    null
  )
  useEffect(() => {
    let current = true
    if (handleId) {
      void loadDownloadRootHandle(handleId)
        .then((handle) => {
          if (current) setFolder({ id: handleId, name: handle?.name ?? "" })
        })
        .catch(() => {
          if (current) setFolder({ id: handleId, name: "" })
        })
    }
    return () => {
      current = false
    }
  }, [handleId])
  const root =
    destination.kind === "downloads-api"
      ? t("destination_taskChrome")
      : (folder?.id === handleId && folder.name) || t("destination_taskFolder")
  const label = [root, requestedPath].filter(Boolean).join("/")
  return (
    <p
      className="text-xs text-muted-foreground break-all"
      data-task-destination
      title={label}
    >
      {label}
      {useChromeFallback ? ` · ${t("destination_chromeFallback")}` : ""}
    </p>
  )
}
