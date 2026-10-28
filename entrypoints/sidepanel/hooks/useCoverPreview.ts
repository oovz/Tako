import { useEffect, useMemo, useState } from "react"
import {
  getCoverPreviewLoader,
  type CoverPreviewIdentity,
  type CoverPreviewResult,
  type CoverPreviewSource,
} from "@/entrypoints/sidepanel/services/cover-preview-loader"

type PreviewState = CoverPreviewResult | { status: "loading" }

export function useCoverPreview(identity?: CoverPreviewIdentity): PreviewState {
  const integrationId = identity?.integrationId
  const coverUrl = identity?.coverUrl
  const kind = identity?.source.kind
  const taskId =
    identity?.source.kind === "task" ? identity.source.taskId : undefined
  const tabId =
    identity?.source.kind === "series" ? identity.source.tabId : undefined
  const windowId =
    identity?.source.kind === "series" ? identity.source.windowId : undefined
  const seriesId =
    identity?.source.kind === "series" ? identity.source.seriesId : undefined
  const seriesRevision =
    identity?.source.kind === "series"
      ? identity.source.seriesRevision
      : undefined
  const source = useMemo<CoverPreviewSource | undefined>(() => {
    if (kind === "task" && taskId) return { kind, taskId }
    if (
      kind === "series" &&
      tabId !== undefined &&
      windowId !== undefined &&
      seriesId &&
      seriesRevision !== undefined
    ) {
      return { kind, tabId, windowId, seriesId, seriesRevision }
    }
  }, [kind, taskId, tabId, windowId, seriesId, seriesRevision])
  const request = useMemo(
    () =>
      integrationId && coverUrl && source
        ? { integrationId, coverUrl, source }
        : undefined,
    [integrationId, coverUrl, source]
  )
  const [state, setState] = useState<{
    request: typeof request
    value: PreviewState
  }>({ request: undefined, value: { status: "fallback" } })

  useEffect(() => {
    if (!request) return
    let released = false
    const preview = getCoverPreviewLoader().acquire(request)
    void preview.result.then((value) => {
      if (!released) setState({ request, value })
    })
    return () => {
      released = true
      preview.release()
    }
  }, [request])

  if (!request) return { status: "fallback" }
  return state.request === request ? state.value : { status: "loading" }
}
