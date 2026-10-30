import type { SiteIntegrationPageProbe } from "@/src/site-integrations/page-probe-contract"
import { z } from "zod"
import {
  MangadexPageProbeDataSchema,
  type MangadexPageProbeData,
} from "./contracts/page-probe"

/** This function is serialized by chrome.scripting.executeScript. */
function collectMangadexPageProbe(): unknown {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return Object.prototype.toString.call(value) === "[object Object]"
  }

  function selectPreferences(
    parsed: unknown
  ): Record<string, unknown> | undefined {
    if (!isRecord(parsed)) return undefined
    return [parsed.userPreferences, parsed.settings].find(isRecord) ?? parsed
  }

  function collectPreferences(
    source: Record<string, unknown>
  ): MangadexPageProbeData {
    const booleanKeys = [
      "dataSaver",
      "showSafe",
      "showSuggestive",
      "showErotic",
      "showHentai",
    ] as const
    const data: MangadexPageProbeData = Object.fromEntries(
      booleanKeys
        .filter((key) => typeof source[key] === "boolean")
        .map((key) => [key, source[key]])
    )
    if (Array.isArray(source.filteredLanguages)) {
      data.filteredLanguages = source.filteredLanguages
        .filter(
          (language): language is string =>
            typeof language === "string" && language.length <= 32
        )
        .slice(0, 32)
    }
    return data
  }

  const result: { url: string; data?: unknown } = {
    url: globalThis.location.href,
  }
  try {
    const raw = globalThis.localStorage.getItem("md")
    if (!raw) return result
    const source = selectPreferences(JSON.parse(raw))
    if (!source) return result
    const data = collectPreferences(source)
    if (Object.keys(data).length > 0) result.data = data
  } catch {
    // Website storage is optional and cannot prevent normal resolution.
  }
  return result
}

const MangadexPageProbeResultSchema = z.strictObject({
  url: z.string().url(),
  data: MangadexPageProbeDataSchema.optional(),
})

function parseMangadexPageProbe(raw: unknown): {
  url: string
  data?: unknown
} {
  return MangadexPageProbeResultSchema.parse(raw)
}

export const pageProbe: SiteIntegrationPageProbe = {
  collect: collectMangadexPageProbe,
  parse: parseMangadexPageProbe,
}
