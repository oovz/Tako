import { useEffect, useMemo, useState } from "react"
import {
  getCoverPreviewLoader,
  type CoverPreviewIdentity,
  type CoverPreviewResult,
  type CoverPreviewSource,
} from "@/entrypoints/sidepanel/services/cover-preview-loader"

type PreviewState = CoverPreviewResult | { status: "loading" }
interface SourceFields {
  kind?: CoverPreviewSource["kind"]
  taskId?: string
  tabId?: number
  windowId?: number
  seriesId?: string
  seriesRevision?: number
}

function sourceFields(source?: CoverPreviewSource): SourceFields {
  if (source?.kind === "task")
    return { kind: source.kind, taskId: source.taskId }
  if (source?.kind === "series") return source
  return {}
}

function previewSource(fields: SourceFields): CoverPreviewSource | undefined {
  const { kind, taskId, tabId, windowId, seriesId, seriesRevision } = fields
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
}

function usePreviewRequest(identity?: CoverPreviewIdentity) {
  const { integrationId, coverUrl, source: rawSource } = identity ?? {}
  const { kind, taskId, tabId, windowId, seriesId, seriesRevision } =
    sourceFields(rawSource)
  const source = useMemo(
    () =>
      previewSource({
        kind,
        taskId,
        tabId,
        windowId,
        seriesId,
        seriesRevision,
      }),
    [kind, taskId, tabId, windowId, seriesId, seriesRevision]
  )
  return useMemo(
    () =>
      integrationId && coverUrl && source
        ? { integrationId, coverUrl, source }
        : undefined,
    [integrationId, coverUrl, source]
  )
}

export function useCoverPreview(identity?: CoverPreviewIdentity): PreviewState {
  const request = usePreviewRequest(identity)
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
