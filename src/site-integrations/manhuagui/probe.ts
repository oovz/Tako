import type { SiteIntegrationPageProbe } from "@/src/site-integrations/page-probe-contract"
import { z } from "zod"
import { ManhuaguiPageProbeDataSchema } from "./contracts/page-probe"

/** This function is serialized by chrome.scripting.executeScript. */
function collectManhuaguiPageProbe(): unknown {
  const result: { url: string; data?: unknown } = {
    url: globalThis.location.href,
  }
  try {
    const adultGatePresent = !!globalThis.document.querySelector("#checkAdult")

    // Adult chapter lists are client-decompressed after the user accepts the
    // site's own gate. Return only chapter DOM already rendered for the user.
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
    result.data = {
      ...(chapterHtml ? { chapterHtml } : {}),
      adultGatePresent,
    }
  } catch {
    // Live DOM extraction is optional; fetched HTML remains authoritative.
  }
  return result
}

const ManhuaguiPageProbeResultSchema = z.strictObject({
  url: z.string().url(),
  data: ManhuaguiPageProbeDataSchema.optional(),
})

function parseManhuaguiPageProbe(raw: unknown): {
  url: string
  data?: unknown
} {
  return ManhuaguiPageProbeResultSchema.parse(raw)
}

export const pageProbe: SiteIntegrationPageProbe = {
  id: "manhuagui",
  collect: collectManhuaguiPageProbe,
  parse: parseManhuaguiPageProbe,
}
