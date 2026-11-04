import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { URL } from "node:url"
import { createContext, runInContext, runInNewContext } from "node:vm"
import { Window } from "happy-dom"
import { build } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import config from "@/wxt.config"
import type { SiteIntegrationPageProbe } from "@/src/site-integrations/page-probe-contract"
import { ManhuaguiPageProbeDataSchema } from "@/src/site-integrations/readmanga/contracts/page-probe"

type ProbeLibrary = {
  manhuagui: SiteIntegrationPageProbe
  mangadex: SiteIntegrationPageProbe
}

const repository = process.cwd()
let workspace: string
let library: ProbeLibrary

beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tako-serialized-probes-"))
  const entry = path.join(workspace, "probes.ts")
  fs.writeFileSync(
    entry,
    [
      `export { pageProbe as manhuagui } from ${JSON.stringify(path.join(repository, "src/site-integrations/readmanga/probe.ts"))}`,
      `export { pageProbe as mangadex } from ${JSON.stringify(path.join(repository, "src/site-integrations/mangadex/probe.ts"))}`,
    ].join("\n")
  )
  if (!config.vite)
    throw new Error("WXT Vite configuration callback is required")
  const policy = await config.vite({
    mode: "e2e-test",
    command: "build",
    browser: "chrome",
    manifestVersion: 3,
  })
  const built = await build({
    ...policy,
    root: repository,
    mode: "e2e-test",
    configFile: false,
    logLevel: "error",
    build: {
      ...policy.build,
      write: false,
      minify: false,
      lib: { entry, name: "TakoProbeBuild", formats: ["iife"] },
    },
  })
  const outputs = Array.isArray(built) ? built : [built]
  const files = outputs.flatMap((output) => {
    if (!("output" in output))
      throw new Error("Expected a completed Vite library build")
    return output.output
  })
  const chunk = files.find((file) => file.type === "chunk" && file.isEntry)
  if (!chunk || chunk.type !== "chunk")
    throw new Error("Missing emitted probe library")
  const moduleContext = createContext({ URL })
  runInContext(chunk.code, moduleContext, {
    filename: "built-probe-library.js",
  })
  library = runInContext("TakoProbeBuild", moduleContext)
}, 30_000)

afterAll(() => {
  if (workspace) fs.rmSync(workspace, { recursive: true, force: true })
})

describe("serialized collectors in the E2E build", () => {
  it("collects rendered Manhuagui chapters after function serialization into a fresh DOM world", async () => {
    const page = new Window({ url: "https://www.manhuagui.com/comic/16177/" })
    try {
      page.document.body.innerHTML =
        '<div class="chapter"><a href="/comic/16177/700001.html">Visible chapter</a></div>'
      const raw = runInNewContext(
        `(${library.manhuagui.collect.toString()})()`,
        { location: page.location, document: page.document }
      )
      const result = library.manhuagui.parse(raw)
      expect(result.url).toBe(page.location.href)
      const data = ManhuaguiPageProbeDataSchema.parse(result.data)
      expect(data.adultGatePresent).toBe(false)
      if (!data.chapterHtml)
        throw new Error("The visible chapter snapshot is required")
      const snapshot = page.document.createElement("div")
      snapshot.innerHTML = data.chapterHtml
      expect(snapshot.querySelector("a")?.getAttribute("href")).toBe(
        "/comic/16177/700001.html"
      )
    } finally {
      await page.happyDOM.close()
    }
  })

  it("collects MangaDex preferences after function serialization into a fresh storage world", async () => {
    const page = new Window({ url: "https://mangadex.org/title/series" })
    try {
      page.localStorage.setItem(
        "md",
        JSON.stringify({
          userPreferences: {
            dataSaver: true,
            showHentai: false,
            filteredLanguages: ["en", "ja"],
          },
        })
      )
      const raw = runInNewContext(
        `(${library.mangadex.collect.toString()})()`,
        { location: page.location, localStorage: page.localStorage }
      )
      expect(library.mangadex.parse(raw)).toEqual({
        url: page.location.href,
        data: {
          dataSaver: true,
          showHentai: false,
          filteredLanguages: ["en", "ja"],
        },
      })
    } finally {
      await page.happyDOM.close()
    }
  })
})
