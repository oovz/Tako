import { useCallback, useEffect, useRef, useState } from "react"
import { subscribeToTrackedTab } from "./useSidepanelTrackedTabIdSubscription"

export { createTrackedTabRefreshCoordinator } from "./useSidepanelTrackedTabIdSubscription"

export function useSidepanelTrackedTabId(windowId: number | undefined): {
  tabId: number | undefined
  activeUrl: string | undefined
} {
  const [trackedTab, setTrackedTab] = useState<{
    tabId: number | undefined
    activeUrl: string | undefined
  }>({ tabId: undefined, activeUrl: undefined })
  const trackedRef = useRef(trackedTab)
  const commitTrackedTab = useCallback(
    (tabId: number | undefined, nextUrl: string | undefined) => {
      const previous = trackedRef.current
      const activeUrl =
        tabId === previous.tabId && nextUrl === undefined
          ? previous.activeUrl
          : nextUrl
      trackedRef.current = { tabId, activeUrl }
      setTrackedTab(trackedRef.current)
    },
    []
  )

  useEffect(() => {
    if (windowId === undefined) return
    return subscribeToTrackedTab({
      windowId,
      getTrackedTabId: () => trackedRef.current.tabId,
      commit: commitTrackedTab,
    })
  }, [commitTrackedTab, windowId])

  return trackedTab
}
