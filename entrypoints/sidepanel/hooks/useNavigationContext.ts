/**
 * @file use-navigation-context.ts
 * @description Centralized navigation state management for the Side Panel
 * 
 * This module provides a clean abstraction over navigation state changes.
 * URL change detection is driven by background events, while the side panel
 * listens for tab switches and background-cleared state changes.
 * 
 * Key Design Decisions:
 * - Per-tab navigation state tracking (no module-level pollution)
 * - Debounced URL change detection (50ms window)
 * - Explicit reset on tab switch
 * - Storage event monitoring for background-triggered state changes
 * 
 * Ref: https://developer.chrome.com/docs/extensions/reference/api/tabs
 * Ref: entrypoints/background/index.ts
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { matchUrl } from '@/src/site-integrations/url-matcher'

export type NavigationState = 'idle' | 'loading' | 'supported' | 'unsupported' | 'error'

export interface NavigationContext {
  /** Current tracked tab ID */
  tabId: number | undefined
  /** Current URL of the tracked tab */
  currentUrl: string | undefined
  /** Whether the current URL is supported by a site integration */
  isSupported: boolean
  /** Navigation state for UI feedback */
  state: NavigationState
  /** Increments when navigation requires reinitialization */
  navigationVersion: number
}

interface NavigationContextOptions {
  /** Called when navigation to a new URL is detected */
  onNavigate?: (tabId: number, url: string, isSupported: boolean) => void
  /** Called when tab state is cleared by background */
  onTabStateCleared?: (tabId: number) => void
  /** Called when switching to a different tab */
  onTabSwitch?: (newTabId: number) => void
}

/**
 * Check if a URL is an internal/non-content URL that we don't support.
 * This includes browser chrome pages, extension pages, and non-HTTP protocols.
 * Ref: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#matchAndGlob
 */
export function isInternalUrl(url: string | undefined): boolean {
  if (!url) return true
  return (
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:') ||
    url.startsWith('view-source:') ||
    url.startsWith('file://') ||
    url.startsWith('mailto:') ||
    url.startsWith('tel:') ||
    url.startsWith('javascript:')
  )
}

/**
 * Query the active tab in the last focused window
 */
export async function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true, active: true })
    return tabs[0] ?? null
  } catch {
    return null
  }
}

/**
 * Hook to manage navigation context for the side panel.
 * Handles all navigation detection and provides a clean interface for URL changes.
 */
export function useNavigationContext(options: NavigationContextOptions = {}): NavigationContext {
  const { onNavigate, onTabStateCleared, onTabSwitch } = options

  // Core state
  const [tabId, setTabId] = useState<number | undefined>(undefined)
  const [currentUrl, setCurrentUrl] = useState<string | undefined>(undefined)
  const [isSupported, setIsSupported] = useState(false)
  const [state, setState] = useState<NavigationState>('loading')
  const [navigationVersion, setNavigationVersion] = useState(0)

  // Refs for stable references in event handlers
  const tabIdRef = useRef<number | undefined>(undefined)
  const currentUrlRef = useRef<string | undefined>(undefined)
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /**
   * Process a URL change for the tracked tab
   */
  const processUrlChange = useCallback((newTabId: number, newUrl: string) => {
    // Skip if same URL (deduplication)
    if (newUrl === currentUrlRef.current && newTabId === tabIdRef.current) {
      return
    }

    // Clear any pending debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    // Debounce to coalesce rapid navigation events
    debounceTimeoutRef.current = setTimeout(() => {
      const urlIsSupported = !isInternalUrl(newUrl) && !!matchUrl(newUrl)

      // Update refs immediately
      tabIdRef.current = newTabId
      currentUrlRef.current = newUrl

      // Update state
      setTabId(newTabId)
      setCurrentUrl(newUrl)
      setIsSupported(urlIsSupported)
      setState(isInternalUrl(newUrl) ? 'unsupported' : (urlIsSupported ? 'supported' : 'unsupported'))
      setNavigationVersion(v => v + 1)

      // Notify callback
      onNavigate?.(newTabId, newUrl, urlIsSupported)
    }, 50)
  }, [onNavigate])

  /**
   * Handle tab switch
   */
  const handleTabSwitch = useCallback(async (newTabId: number) => {
    // Skip if same tab
    if (newTabId === tabIdRef.current) return

    // Clear debounce timer to prevent stale updates
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
      debounceTimeoutRef.current = undefined
    }

    // Reset current URL tracking for new tab (critical fix for deduplication issue)
    currentUrlRef.current = undefined

    // Set loading state while we fetch the new tab's URL
    setState('loading')
    setTabId(newTabId)
    tabIdRef.current = newTabId

    // Notify callback
    onTabSwitch?.(newTabId)

    // Fetch the tab's current URL
    try {
      const tab = await chrome.tabs.get(newTabId)
      if (tab?.url && tabIdRef.current === newTabId) {
        processUrlChange(newTabId, tab.url)
      }
    } catch {
      // Tab may have been closed
      setState('error')
    }
  }, [onTabSwitch, processUrlChange])

  // Initialize on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        // Query active tab
        const activeTab = await queryActiveTab()
        if (typeof activeTab?.id === 'number' && activeTab.url) {
          processUrlChange(activeTab.id, activeTab.url)
        } else if (typeof activeTab?.id === 'number') {
          // Tab exists but URL not available yet (e.g., loading)
          tabIdRef.current = activeTab.id
          setTabId(activeTab.id)
          setState('loading')
        } else {
          setState('unsupported')
        }
      } catch {
        setState('error')
      }
    }

    // Fire-and-forget: React useEffect is sync; async initialization runs in background
    void initialize()

    // Cleanup debounce on unmount
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [processUrlChange])

  // Listen for tab activation (tab switch)
  useEffect(() => {
    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      // Fire-and-forget: event listener is sync; async tab switch handling runs in background
      void handleTabSwitch(activeInfo.tabId)
    }

    chrome.tabs.onActivated.addListener(handleActivated)
    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated)
    }
  }, [handleTabSwitch])

  // Listen for tab state being cleared by background
  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => {
      if (areaName !== 'session') return

      const currentTabId = tabIdRef.current
      if (currentTabId == null) return

      const tabKey = `tab_${currentTabId}`

      // Check if our tab's state was cleared (newValue is undefined/null)
      if (tabKey in changes) {
        const change = changes[tabKey]
        if (change.newValue === undefined || change.newValue === null) {
          // Background cleared the tab state - update to unsupported
          setIsSupported(false)
          setState('unsupported')
          onTabStateCleared?.(currentTabId)
        }
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [onTabStateCleared])

  return {
    tabId,
    currentUrl,
    isSupported,
    state,
    navigationVersion,
  }
}

export default useNavigationContext

