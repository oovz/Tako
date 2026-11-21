/** Firefox extension requests use the ordinary, default cookie store. */
export function isSupportedBrowsingContext(tab: {
  incognito?: boolean
  cookieStoreId?: string
}): boolean {
  return (
    !import.meta.env.FIREFOX ||
    (!tab.incognito && tab.cookieStoreId === "firefox-default")
  )
}
