import type { Page } from "@playwright/test"

/**
 * Shared helpers for live download/metadata specs.
 *
 * These functions are extracted from download-workflow.spec.ts and
 * numeric-metadata-extraction.spec.ts where they were duplicated
 * identically (or near-identically). They operate on extension pages
 * via chrome.* APIs evaluated in the browser context.
 */

/**
 * Resolve candidate tab IDs for content-script reinjection.
 *
 * Returns the preferred tab ID first, followed by any other tabs whose
 * URL matches the target hostname and a overlapping pathname prefix.
 * Duplicates are removed.
 */
export async function resolveCandidateTabIds(
  optionsPage: Page,
  preferredTabId: number,
  targetHref: string
): Promise<number[]> {
  return await optionsPage.evaluate(
    async ({
      preferredTabId: preferredId,
      targetHref: href,
    }: {
      preferredTabId: number
      targetHref: string
    }) => {
      const target = new URL(href)
      const allTabs = await chrome.tabs.query({})

      const urlMatchedIds = allTabs
        .filter((tab) => {
          if (typeof tab.id !== "number" || !tab.url) {
            return false
          }

          try {
            const url = new URL(tab.url)
            if (url.hostname !== target.hostname) {
              return false
            }

            return (
              url.pathname === target.pathname ||
              url.pathname.startsWith(target.pathname) ||
              target.pathname.startsWith(url.pathname)
            )
          } catch {
            return false
          }
        })
        .map((tab) => tab.id as number)

      return [preferredId, ...urlMatchedIds].filter(
        (id, index, arr): id is number =>
          typeof id === "number" && arr.indexOf(id) === index
      )
    },
    { preferredTabId, targetHref }
  )
}
