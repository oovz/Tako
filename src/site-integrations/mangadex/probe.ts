import type { SiteIntegrationPageProbe } from "@/src/site-integrations/page-probe-contract"
import { z } from "zod"
import {
  MangadexPageProbeDataSchema,
  type MangadexPageProbeData,
} from "./contracts/page-probe"

/** This function is serialized by chrome.scripting.executeScript. */
function collectMangadexPageProbe(): unknown {
  const result: { url: string; data?: unknown } = {
    url: globalThis.location.href,
  }
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
    const data: MangadexPageProbeData = {}

    for (const key of [
      "dataSaver",
      "showSafe",
      "showSuggestive",
      "showErotic",
      "showHentai",
    ] as const) {
      if (typeof sourceRecord[key] === "boolean") {
        data[key] = sourceRecord[key]
      }
    }

    if (Array.isArray(sourceRecord.filteredLanguages)) {
      data.filteredLanguages = sourceRecord.filteredLanguages
        .filter(
          (language): language is string =>
            typeof language === "string" && language.length <= 32
        )
        .slice(0, 32)
    }

    if (Object.keys(data).length > 0) {
      result.data = data
    }
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
  id: "mangadex",
  collect: collectMangadexPageProbe,
  parse: parseMangadexPageProbe,
}
