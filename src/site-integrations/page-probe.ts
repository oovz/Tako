export interface MangadexPageProbePreferences {
  dataSaver?: boolean
  filteredLanguages?: string[]
  showSafe?: boolean
  showSuggestive?: boolean
  showErotic?: boolean
  showHentai?: boolean
}

export interface PageProbeResult {
  url: string
  mangadexPreferences?: MangadexPageProbePreferences
  /**
   * Integration-owned, schema-validated live page data. This remains opaque to
   * the core resolver; only the integration that requested the probe may
   * interpret it.
   */
  integrationContext?: Record<string, unknown>
}

/**
 * Self-contained function serialized by chrome.scripting.executeScript.
 * It accepts only an integration ID and exposes a fixed, reviewed data shape;
 * callers cannot supply selectors, storage keys, or executable code.
 */
export function collectApprovedPageProbeData(
  integrationId: string
): PageProbeResult {
  const result: PageProbeResult = { url: globalThis.location.href }
  if (integrationId === "mangadex") {
    try {
      const raw = globalThis.localStorage.getItem("md")
      if (!raw) return result

      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return result
      }

      const parsedRecord = parsed as Record<string, unknown>
      const userPreferences = parsedRecord.userPreferences
      const settings = parsedRecord.settings
      const source =
        userPreferences &&
        typeof userPreferences === "object" &&
        !Array.isArray(userPreferences)
          ? userPreferences
          : settings && typeof settings === "object" && !Array.isArray(settings)
            ? settings
            : parsedRecord
      const sourceRecord = source as Record<string, unknown>
      const preferences: MangadexPageProbePreferences = {}

      for (const key of [
        "dataSaver",
        "showSafe",
        "showSuggestive",
        "showErotic",
        "showHentai",
      ] as const) {
        if (typeof sourceRecord[key] === "boolean") {
          preferences[key] = sourceRecord[key]
        }
      }

      if (Array.isArray(sourceRecord.filteredLanguages)) {
        preferences.filteredLanguages = sourceRecord.filteredLanguages
          .filter(
            (language): language is string =>
              typeof language === "string" && language.length <= 32
          )
          .slice(0, 32)
      }

      if (Object.keys(preferences).length > 0) {
        result.mangadexPreferences = preferences
      }
    } catch {
      // Website storage is optional and must not prevent normal resolution.
    }
  }

  if (integrationId === "manhuagui") {
    try {
      const adultGatePresent =
        !!globalThis.document.querySelector("#checkAdult")

      // Adult chapter lists are client-decompressed by Manhuagui after the
      // user accepts its own gate. The server response remains gated even with
      // the browser cookie, so return only the already-rendered chapter DOM.
      // Do not read, synthesize, or report the site's consent cookie.
      const snapshot = globalThis.document.createElement("div")
      const chapterContainers = Array.from(
        globalThis.document.querySelectorAll(".chapter")
      ).slice(0, 32)
      for (const source of chapterContainers) {
        const clone = source.cloneNode(true) as HTMLElement
        for (const unsafeNode of Array.from(
          clone.querySelectorAll("script, style, iframe, object, embed, form")
        )) {
          unsafeNode.remove()
        }
        snapshot.append(clone)
      }
      const chapterHtml = snapshot.innerHTML.slice(0, 512_000)

      result.integrationContext = {
        ...(chapterHtml ? { chapterHtml } : {}),
        adultGatePresent,
      }

      if (adultGatePresent) {
        // This function is injected in the isolated extension world. Keep a
        // single short-lived observer only while the site owns the gate; once
        // it has replaced the gate with visible chapter data, request one
        // background refresh and immediately disconnect. This is deliberately
        // not a resident site-wide content script.
        const observerKey = "__takoManhuaguiAdultGateObserver"
        const globals = globalThis as typeof globalThis &
          Record<string, unknown>
        if (
          globals[observerKey] !== true &&
          globalThis.document.documentElement
        ) {
          globals[observerKey] = true
          const observer = new MutationObserver(() => {
            const gateStillPresent =
              !!globalThis.document.querySelector("#checkAdult")
            const hasChapterList = !!globalThis.document.querySelector(
              ".chapter .chapter-list"
            )
            if (gateStillPresent || !hasChapterList) return

            observer.disconnect()
            delete globals[observerKey]
            void chrome.runtime
              .sendMessage({
                type: "REQUEST_TAB_CONTEXT_REFRESH",
                payload: { reason: "manhuagui-adult-gate" },
              })
              .catch(() => undefined)
          })
          observer.observe(globalThis.document.documentElement, {
            childList: true,
            subtree: true,
          })
        }
      }
    } catch {
      // Live DOM extraction is optional. The normal fetched-HTML resolver
      // still handles non-gated Manhuagui pages when the probe is unavailable.
    }
  }
  return result
}

function parseIntegrationContext(
  integrationId: string,
  rawContext: unknown
): Record<string, unknown> | undefined {
  if (rawContext === undefined) return undefined
  if (
    !rawContext ||
    typeof rawContext !== "object" ||
    Array.isArray(rawContext) ||
    integrationId !== "manhuagui"
  ) {
    throw new Error("Page probe returned invalid integration context")
  }

  const context = rawContext as Record<string, unknown>
  const allowedKeys = new Set(["chapterHtml", "adultGatePresent"])
  if (Object.keys(context).some((key) => !allowedKeys.has(key))) {
    throw new Error("Page probe returned invalid Manhuagui context")
  }

  const parsed: Record<string, unknown> = {}
  if (context.chapterHtml !== undefined) {
    if (
      typeof context.chapterHtml !== "string" ||
      context.chapterHtml.length === 0 ||
      context.chapterHtml.length > 512_000
    ) {
      throw new Error("Page probe returned invalid Manhuagui chapter HTML")
    }
    parsed.chapterHtml = context.chapterHtml
  }
  if (typeof context.adultGatePresent !== "boolean") {
    throw new Error("Page probe returned invalid Manhuagui gate state")
  }
  parsed.adultGatePresent = context.adultGatePresent
  return parsed
}

export async function executeApprovedPageProbe(
  tabId: number,
  integrationId: string
): Promise<PageProbeResult> {
  const injection = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "ISOLATED",
    injectImmediately: true,
    func: collectApprovedPageProbeData,
    args: [integrationId],
  })
  const candidate: unknown = injection[0]?.result
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Page probe returned no structured result")
  }

  const value = candidate as Record<string, unknown>
  if (typeof value.url !== "string") {
    throw new Error("Page probe returned an invalid URL")
  }
  const rawPreferences = value.mangadexPreferences
  const integrationContext = parseIntegrationContext(
    integrationId,
    value.integrationContext
  )
  if (
    rawPreferences !== undefined &&
    (!rawPreferences ||
      typeof rawPreferences !== "object" ||
      Array.isArray(rawPreferences))
  ) {
    throw new Error("Page probe returned invalid MangaDex preferences")
  }

  let mangadexPreferences: MangadexPageProbePreferences | undefined
  if (rawPreferences !== undefined) {
    const rawRecord = rawPreferences as Record<string, unknown>
    const allowedKeys = new Set([
      "dataSaver",
      "filteredLanguages",
      "showSafe",
      "showSuggestive",
      "showErotic",
      "showHentai",
    ])
    if (Object.keys(rawRecord).some((key) => !allowedKeys.has(key))) {
      throw new Error("Page probe returned invalid MangaDex preferences")
    }

    const preferences: MangadexPageProbePreferences = {}
    for (const key of [
      "dataSaver",
      "showSafe",
      "showSuggestive",
      "showErotic",
      "showHentai",
    ] as const) {
      if (rawRecord[key] !== undefined) {
        if (typeof rawRecord[key] !== "boolean") {
          throw new Error("Page probe returned invalid MangaDex preferences")
        }
        preferences[key] = rawRecord[key]
      }
    }
    if (rawRecord.filteredLanguages !== undefined) {
      const languages = rawRecord.filteredLanguages
      if (
        !Array.isArray(languages) ||
        languages.length > 32 ||
        languages.some(
          (language) => typeof language !== "string" || language.length > 32
        )
      ) {
        throw new Error("Page probe returned invalid MangaDex preferences")
      }
      preferences.filteredLanguages = languages
    }
    mangadexPreferences = preferences
  }

  return {
    url: value.url,
    ...(mangadexPreferences !== undefined ? { mangadexPreferences } : {}),
    ...(integrationContext !== undefined ? { integrationContext } : {}),
  }
}
