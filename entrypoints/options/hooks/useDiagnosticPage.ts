import { useEffect, useState } from "react"
import {
  readDiagnosticPage,
  type DiagnosticCursor,
  type DiagnosticPage,
  type DiagnosticQuery,
} from "@/src/runtime/diagnostic-store"

type PageState = { page?: DiagnosticPage; failed?: boolean }
const REFRESH_INTERVAL_MS = 1_000

export function useDiagnosticPage(
  query: DiagnosticQuery,
  before: DiagnosticCursor | undefined,
  paused: boolean,
  refresh: number
): PageState {
  const [state, setState] = useState<
    | (PageState & {
        query: DiagnosticQuery
        before?: DiagnosticCursor
        refresh: number
      })
    | null
  >(null)
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()
    let revision: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    async function read() {
      try {
        const page = await readDiagnosticPage(
          query,
          before,
          revision,
          controller.signal
        )
        if (controller.signal.aborted) return
        if (page) {
          revision = page.revision
          setState({ query, before, refresh, page })
        }
      } catch {
        if (controller.signal.aborted) return
        revision = undefined
        setState({ query, before, refresh, failed: true })
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void read(), REFRESH_INTERVAL_MS)
      }
    }
    void read()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [before, paused, query, refresh])

  return state?.query === query &&
    state.before === before &&
    state.refresh === refresh
    ? state
    : {}
}
