import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page, Worker } from "@playwright/test"
import type { DiagnosticReport } from "@/src/runtime/diagnostic-report"
import {
  expect,
  launchExtensionProfile,
  resolveBackgroundWorker,
  stopBackgroundWorker,
  test,
} from "./fixtures/extension"
import { readRetainedDiagnostics } from "./fixtures/retained-diagnostics"
import { OptionsPageObject } from "./pages/options"
import { makeChapter, makeTask } from "./fixtures/queue-test-helpers"
import {
  seedDownloadQueueStateInContext,
  setDownloadedChapterHistory,
} from "./fixtures/state-helpers"

test("Options diagnostics survive closing and reopening the producing page", async ({
  context,
  extensionId,
}) => {
  const producer = await context.newPage()
  const options = new OptionsPageObject(producer, extensionId)
  await options.navigate()
  await options.toggleNotifications()
  await producer.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = ((message: { type: string }) =>
      message.type === "SAVE_OPTIONS_CONFIGURATION"
        ? Promise.reject(
            new Error(
              "Save fixture https://example.com/settings?token=PRIVATE_MARKER"
            )
          )
        : send(message)) as typeof chrome.runtime.sendMessage
  })
  await producer.getByRole("button", { name: "Save Changes" }).click()
  await options.switchToSection("diagnostics")
  const message = producer.getByText("[OPTIONS] Failed to save settings:", {
    exact: true,
  })
  await expect(message).toBeVisible()
  await producer.close()

  const reader = await context.newPage()
  await new OptionsPageObject(reader, extensionId).navigate("diagnostics")
  await expect(
    reader.getByText("[OPTIONS] Failed to save settings:", { exact: true })
  ).toBeVisible()
})

test("pauses the live view while capture continues and filters the retained log", async ({
  context,
  page,
  extensionId,
}) => {
  const options = new OptionsPageObject(page, extensionId)
  await options.navigate("diagnostics")
  const secondary = await context.newPage()
  await new OptionsPageObject(secondary, extensionId).navigate("diagnostics")
  const liveSearch = secondary.getByRole("searchbox", { name: "Search logs" })
  await liveSearch.fill("diagnostic-search-marker")
  await page.getByRole("button", { name: "Pause updates" }).click()
  await page.evaluate(() => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "diagnostic-search-marker first",
        error: new Error(
          "Read https://example.com/episode?token=PRIVATE_MARKER"
        ),
      })
    )
  })
  await expect(
    secondary.getByText("Uncaught error", { exact: true })
  ).toBeVisible()
  await capture(secondary, "diagnostic-search-marker second")
  await expect(
    secondary.getByText("Uncaught error", { exact: true })
  ).toHaveCount(2)
  await expect(page.getByText("Uncaught error", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Resume updates" }).click()
  await page
    .getByRole("searchbox", { name: "Search logs" })
    .fill("diagnostic-search-marker first")
  await page.getByLabel("Source").selectOption("sidepanel")
  await expect(page.getByText("No matching diagnostic entries.")).toBeVisible()
  await page.getByLabel("Source").selectOption("options")
  await page.getByLabel("Level", { exact: true }).selectOption("warn")
  await expect(page.getByText("No matching diagnostic entries.")).toBeVisible()
  await page.getByLabel("Level", { exact: true }).selectOption("error")
  const row = page.getByRole("listitem").filter({ hasText: "Uncaught error" })
  await expect(row).toBeVisible()
  await row.getByText("Details", { exact: true }).click()
  await expect(row.getByText(/https:\/\/example\.com\/episode/)).toBeVisible()
  await expect(row).not.toContainText("PRIVATE_MARKER")
  await page.getByLabel("From").fill("2100-01-01T00:00")
  await expect(page.getByText("No matching diagnostic entries.")).toBeVisible()
  await page.getByLabel("From").clear()
  await expect(row).toBeVisible()

  const savedAt = Date.now()
  const chapterUrl = "https://mangadex.org/chapter/fixture-previous"
  await seedDownloadQueueStateInContext(context, [
    makeTask({
      id: "prior-task",
      seriesTitle: "Previously downloaded series",
      status: "completed",
      created: savedAt,
      completed: savedAt,
      chapters: [makeChapter(chapterUrl, "completed")],
    }),
  ])
  await setDownloadedChapterHistory(context, [
    {
      siteIntegrationId: "mangadex",
      seriesId: "mangadex:series-1",
      seriesTitle: "Previously downloaded series",
      chapterId: "fixture-previous",
      title: "Previously downloaded chapter",
      url: chapterUrl,
      downloadedAt: savedAt,
      saveConfirmedAt: savedAt,
      outputDestination: "downloads-api",
      format: "cbz",
    },
  ])
  await page.evaluate(async (ts) => {
    await chrome.storage.local.set({
      persistent_errors: [
        { code: "fixture", message: "Action needed", severity: "warning", ts },
      ],
    })
  }, savedAt)
  const keys = [
    "settings:global",
    "downloadQueue",
    "downloadedChapters",
    "persistent_errors",
  ]
  const saved = await page.evaluate(
    (keys) => chrome.storage.local.get(keys),
    keys
  )
  await page.evaluate(() => {
    const clear = IDBObjectStore.prototype.clear
    IDBObjectStore.prototype.clear = function () {
      const request = clear.call(this)
      if (this.name === "entries") {
        IDBObjectStore.prototype.clear = clear
        request.addEventListener(
          "success",
          () => {
            window.dispatchEvent(
              new ErrorEvent("error", {
                message: "Concurrent append during clear",
              })
            )
          },
          { once: true }
        )
      }
      return request
    }
  })
  await page.getByRole("button", { name: "Clear logs" }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Clear logs" })
    .click()
  await expect(page.getByText("No matching diagnostic entries.")).toBeVisible()
  expect(
    await page.evaluate((keys) => chrome.storage.local.get(keys), keys)
  ).toEqual(saved)
  await liveSearch.fill("Concurrent append during clear")
  await expect(
    secondary.getByText("Uncaught error", { exact: true })
  ).toBeVisible()
  await capture(page, "diagnostic-search-marker first after clear")
  await expect(row).toBeVisible()
  await secondary.close()
})

test("downloads a versioned report of matching redacted entries and all entries without filters", async ({
  page,
  extensionId,
}) => {
  await new OptionsPageObject(page, extensionId).navigate("diagnostics")
  await page.evaluate(() => {
    for (const message of ["export-mark-first", "export-mark-second"]) {
      window.dispatchEvent(
        new ErrorEvent("error", {
          message,
          error: new Error(
            "https://example.com/book?token=EXPORT_SECRET_MARKER"
          ),
        })
      )
    }
  })

  const search = page.getByRole("searchbox", { name: "Search logs" })
  await search.fill("export-mark-first")
  await expect(page.getByText("Uncaught error", { exact: true })).toBeVisible()

  const downloadReport = async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export JSON" }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^tako-diagnostics-.*\.json$/)
    const file = await readFile(await download.path(), "utf8")
    expect(file).not.toContain("EXPORT_SECRET_MARKER")
    return JSON.parse(file) as DiagnosticReport
  }

  await page.getByRole("button", { name: "Pause updates" }).click()
  await page.evaluate(() => {
    const openCursor = IDBObjectStore.prototype.openCursor
    IDBObjectStore.prototype.openCursor = function (
      ...args: Parameters<IDBObjectStore["openCursor"]>
    ) {
      const request = openCursor.apply(this, args)
      if (this.name === "entries") {
        IDBObjectStore.prototype.openCursor = openCursor
        request.addEventListener(
          "success",
          () => {
            window.dispatchEvent(
              new ErrorEvent("error", {
                message: "export-mark-first concurrent append",
              })
            )
          },
          { once: true }
        )
      }
      return request
    }
  })
  const filtered = await downloadReport()
  expect(filtered).toMatchObject({
    format: "tako-diagnostics",
    version: 1,
    exportedAt: expect.any(String),
    entries: [
      {
        context: "options",
        level: "error",
        details: {
          message: "export-mark-first",
          error: { message: "https://example.com/book" },
        },
      },
    ],
  })
  expect(Number.isFinite(Date.parse(filtered.exportedAt))).toBe(true)
  await page.getByRole("button", { name: "Resume updates" }).click()
  await expect(page.getByText("Uncaught error", { exact: true })).toHaveCount(2)
  await search.clear()
  const all = await downloadReport()
  expect(all.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        details: expect.objectContaining({ message: "export-mark-first" }),
      }),
      expect.objectContaining({
        details: expect.objectContaining({ message: "export-mark-second" }),
      }),
    ])
  )
})

async function capture(
  page: Page,
  message: string,
  capturedAt?: number
): Promise<void> {
  await page.evaluate(
    ({ message, capturedAt }) => {
      const now = Date.now
      try {
        if (capturedAt !== undefined) Date.now = () => capturedAt
        window.dispatchEvent(new ErrorEvent("error", { message }))
      } finally {
        Date.now = now
      }
    },
    { message, capturedAt }
  )
}

async function setLevel(
  page: Page,
  logLevel: "debug" | "info" | "warn" | "error"
): Promise<void> {
  await page.evaluate(async (logLevel) => {
    const key = "settings:global"
    const { [key]: settings } = await chrome.storage.local.get<{
      [key: string]: { advanced: object }
    }>(key)
    await chrome.storage.local.set({
      [key]: { ...settings, advanced: { ...settings.advanced, logLevel } },
    })
  }, logLevel)
}

async function openOffscreen(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification:
          "Exercise retained diagnostics for the extension offscreen context",
      })
    }
  })
}

test("retains an old committed entry across a Chromium restart with the same profile", async ({
  headless,
}) => {
  const profile = await mkdtemp(join(tmpdir(), "tako-diagnostics-restart-"))
  let launched = await launchExtensionProfile(profile, headless)
  try {
    const worker = await resolveBackgroundWorker(launched)
    const extensionId = new URL(worker.url()).hostname
    const page = await launched.newPage()
    const options = new OptionsPageObject(page, extensionId)
    await options.navigate()
    const readLevel = (source: Page) =>
      source.evaluate(async () => {
        const key = "settings:global"
        const { [key]: settings } =
          await chrome.storage.local.get<
            Record<string, { advanced: { logLevel: string } }>
          >(key)
        return settings?.advanced.logLevel
      })
    await expect.poll(() => readLevel(page)).toBe("info")
    await setLevel(page, "debug")

    await options.navigate("diagnostics")
    await capture(page, "Old entry survives restart", Date.UTC(2001, 0, 1))
    await page.getByRole("searchbox").fill("Old entry survives restart")
    await expect(
      page.getByText("Uncaught error", { exact: true })
    ).toBeVisible()
    await launched.close()
    launched = await launchExtensionProfile(profile, headless)
    const reopened = await launched.newPage()
    await new OptionsPageObject(reopened, extensionId).navigate()
    await expect.poll(() => readLevel(reopened)).toBe("debug")
    const { entries } = await readRetainedDiagnostics(launched, extensionId)
    expect(entries).toContainEqual(
      expect.objectContaining({
        capturedAt: Date.UTC(2001, 0, 1),
        message: "Uncaught error",
        details: expect.objectContaining({
          message: "Old entry survives restart",
        }),
      })
    )
  } finally {
    await launched.close()
    await rm(profile, { recursive: true, force: true })
  }
})

test("reads retained background, offscreen and Side Panel entries after their producers close and startup fails", async ({
  context,
  page,
  extensionId,
  _extensionContextState,
}, testInfo) => {
  const worker = _extensionContextState.backgroundWorker
  await new OptionsPageObject(page, extensionId).navigate("diagnostics")
  await setLevel(page, "error")
  await openOffscreen(worker)
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  // Finish the Error-level cold start before updating the active document.
  await expect
    .poll(
      async () =>
        await worker.evaluate(async () => {
          const response = (await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "OFFSCREEN_STATUS",
          })) as { initializationState?: string }
          return response.initializationState
        })
    )
    .toBe("ready")
  const beforeChange = await readRetainedDiagnostics(context, extensionId)
  expect(beforeChange.entries).not.toContainEqual(
    expect.objectContaining({ context: "offscreen", level: "debug" })
  )

  const debugReceipt = (producer: Page) =>
    producer.waitForEvent("console", {
      predicate: (message) =>
        message.type() === "debug" &&
        message.text().includes("Saved diagnostic logging level applied"),
    })
  const optionsDebug = debugReceipt(page)
  const panelDebug = debugReceipt(panel)
  await setLevel(page, "debug")
  await Promise.all([optionsDebug, panelDebug])
  const offscreen = page
    .getByRole("listitem")
    .filter({ hasText: "Offscreen document" })
  await expect(
    offscreen.getByText("Saved diagnostic logging level applied", {
      exact: true,
    })
  ).toBeVisible()

  await worker.evaluate(() => chrome.offscreen.closeDocument())
  await openOffscreen(worker)
  const panelError = panel.waitForEvent("pageerror")
  await panel.evaluate(() => {
    setTimeout(() => {
      throw new Error("Synthetic Side Panel diagnostic")
    })
  })
  expect((await panelError).message).toContain(
    "Synthetic Side Panel diagnostic"
  )

  await worker.evaluate(() => {
    self.dispatchEvent(
      new ErrorEvent("error", {
        message:
          "Synthetic background diagnostic https://example.com/reader?token=STORED_HISTORY_SECRET",
      })
    )
  })
  const message = page.getByText("Uncaught error", { exact: true })
  await expect(message).toHaveCount(2)
  await expect(
    page.getByText("✅ Offscreen document script loaded", { exact: true })
  ).toBeVisible()

  const savedSettings = await page.evaluate(
    async () =>
      (await chrome.storage.local.get("settings:global"))[
        "settings:global"
      ] as unknown
  )
  await panel.close()
  await worker.evaluate(() => chrome.offscreen.closeDocument())
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      stateSchemaEpoch: 999_999,
      "settings:global": {},
    })
  })
  await stopBackgroundWorker(context, page, extensionId)
  const reader = await context.newPage()
  const options = new OptionsPageObject(reader, extensionId)
  await options.navigate()
  await expect(reader.getByRole("alert")).toBeVisible()
  await reader.getByTestId("open-diagnostics").click()
  await expect(
    reader.getByTestId("diagnostic-verbosity-fallback")
  ).toBeVisible()
  await expect(
    reader.getByText("Failed to initialize extension runtime", { exact: true })
  ).toBeVisible()

  const artifact = testInfo.outputPath("history-after-startup-failure.json")
  const report = await readRetainedDiagnostics(context, extensionId, artifact)
  const serialized = await readFile(artifact, "utf8")
  expect(JSON.parse(serialized)).toEqual(report)
  expect(serialized).not.toContain("STORED_HISTORY_SECRET")
  expect(report.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        context: "background",
        message: "Uncaught error",
        details: expect.objectContaining({
          message: expect.stringContaining("https://example.com/reader"),
        }),
      }),
      expect.objectContaining({
        context: "background",
        message: "Failed to initialize extension runtime",
      }),
      expect.objectContaining({
        context: "sidepanel",
        message: "Uncaught error",
        details: expect.objectContaining({
          message: expect.stringContaining("Synthetic Side Panel diagnostic"),
        }),
      }),
      expect.objectContaining({
        context: "offscreen",
        level: "debug",
        message: "✅ Offscreen document script loaded",
      }),
    ])
  )
  await reader.evaluate(async (settings) => {
    await chrome.storage.local.set({ "settings:global": settings })
  }, savedSettings)
  await expect(reader.getByTestId("diagnostic-verbosity-fallback")).toBeHidden()
})

test("keeps console errors and allows saving settings when the diagnostic store is unavailable", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (name, version) {
      if (name === "tako-diagnostics")
        throw new DOMException(
          "Fixture storage unavailable",
          "QuotaExceededError"
        )
      return open.call(this, name, version)
    }
  })
  const options = new OptionsPageObject(page, extensionId)
  await options.navigate("diagnostics")
  await expect(
    page.getByText("Diagnostic entries are unavailable.")
  ).toBeVisible()
  await expect(page.getByText("No diagnostic entries.")).toHaveCount(0)
  const consoleError = page.waitForEvent("console", {
    predicate: (message) =>
      message.type() === "error" &&
      message.text().includes("[TMD] Uncaught error"),
  })
  await capture(page, "fixture storage failure")
  await consoleError
  await options.switchToSection("general")
  const previous = await options.areNotificationsEnabled()
  await options.toggleNotifications()
  await options.saveSettings()
  await page.reload()
  expect(await options.areNotificationsEnabled()).toBe(!previous)
})

test("evicts the oldest serialized entries under concurrent producer writes", async ({
  context,
  page,
  extensionId,
}) => {
  const options = new OptionsPageObject(page, extensionId)
  await options.navigate("diagnostics")
  await capture(page, "oldest retained marker", Date.UTC(2002, 0, 1))
  const search = page.getByRole("searchbox", { name: "Search logs" })
  await search.fill("oldest retained marker")
  await expect(page.getByText("Uncaught error", { exact: true })).toBeVisible()

  const other = await context.newPage()
  await new OptionsPageObject(other, extensionId).navigate("diagnostics")
  const emitBatch = async (producer: Page, name: string, batch: number) => {
    await producer.evaluate(
      ({ name, batch }) => {
        const fields = Object.fromEntries(
          Array.from({ length: 15 }, (_, i) => [`field${i}`, "x".repeat(2_000)])
        )
        for (let i = 0; i < 25; i += 1) {
          const message = `${name}-${batch}-${i}`
          window.dispatchEvent(
            new PromiseRejectionEvent("unhandledrejection", {
              promise: Promise.resolve(),
              reason: { message, taskId: name, ...fields },
            })
          )
        }
      },
      { name, batch }
    )
    await producer
      .getByRole("searchbox", { name: "Search logs" })
      .fill(`${name}-${batch}-24`)
    await expect(
      producer.getByText("Unhandled promise rejection", { exact: true })
    ).toBeVisible()
  }
  for (let batch = 0; batch < 8; batch += 1) {
    await Promise.all([
      emitBatch(page, "writer-a", batch),
      emitBatch(other, "writer-b", batch),
    ])
  }
  await page.evaluate(() => {
    const fields = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`field${i}`, "x".repeat(2_000)])
    )
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: { taskId: "oversized-entry", ...fields },
      })
    )
  })
  await search.fill("oversized-entry")
  await expect(
    page.getByText("Unhandled promise rejection", { exact: true })
  ).toBeVisible()
  await other.close()
  const report = await readRetainedDiagnostics(context, extensionId)
  const size = report.entries.reduce(
    (total, entry) => total + Buffer.byteLength(JSON.stringify(entry)),
    0
  )
  expect(size).toBeGreaterThan(9.9 * 1024 * 1024)
  expect(size).toBeLessThanOrEqual(10 * 1024 * 1024)
  expect(report.entries).not.toContainEqual(
    expect.objectContaining({
      details: expect.objectContaining({ message: "oldest retained marker" }),
    })
  )
  expect(report.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        taskId: "oversized-entry",
        details: "[Oversized diagnostic omitted]",
      }),
      expect.objectContaining({
        taskId: "writer-a",
        details: expect.objectContaining({ message: "writer-a-7-24" }),
      }),
      expect.objectContaining({
        taskId: "writer-b",
        details: expect.objectContaining({ message: "writer-b-7-24" }),
      }),
    ])
  )
})
