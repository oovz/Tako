import { readFile } from "node:fs/promises"
import type { BrowserContext, Page, TestInfo } from "@playwright/test"
import type { DiagnosticReport } from "../../../src/runtime/diagnostic-report"
import { redactDiagnostic } from "../../../src/runtime/diagnostic-redaction"

const DEADLINE_MS = 12_000

/** Read a report from the already running extension's BrowserContext. */
export async function readRetainedDiagnostics(
  context: BrowserContext,
  extensionId: string,
  outputPath?: string
): Promise<DiagnosticReport> {
  const timeoutMessage =
    "Timed out reading retained diagnostics from the active profile"
  let page: Page | undefined
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), DEADLINE_MS)
  })

  async function read() {
    page = await context.newPage()
    if (expired) {
      await page.close()
      throw new Error(timeoutMessage)
    }
    const origin = `chrome-extension://${extensionId}`
    await page
      .goto(`${origin}/options.html?tab=diagnostics`, {
        waitUntil: "domcontentloaded",
        timeout: DEADLINE_MS,
      })
      .catch(() => {
        throw new Error(
          "The target extension is unavailable in this browser profile"
        )
      })
    if ((await page.evaluate(() => chrome.runtime?.id)) !== extensionId) {
      throw new Error(
        "The target extension is unavailable in this browser profile"
      )
    }
    const [download] = await Promise.all([
      Promise.race([
        page.waitForEvent("download", { timeout: DEADLINE_MS }),
        page
          .getByTestId("diagnostics-export-failed")
          .waitFor({ timeout: DEADLINE_MS })
          .then(() => {
            throw new Error("Retained diagnostics are unavailable")
          }),
      ]),
      page.getByTestId("export-diagnostics").click({ timeout: DEADLINE_MS }),
    ])
    const report = JSON.parse(
      await readFile(await download.path(), "utf8")
    ) as Partial<DiagnosticReport>
    if (
      report.format !== "tako-diagnostics" ||
      report.version !== 1 ||
      typeof report.exportedAt !== "string" ||
      !Array.isArray(report.entries)
    ) {
      throw new Error("The retained diagnostic report is invalid")
    }
    if (outputPath && !expired) await download.saveAs(outputPath)
    return report as DiagnosticReport
  }

  try {
    return await Promise.race([read(), deadline])
  } finally {
    expired = true
    clearTimeout(timer)
    void page?.close().catch(() => {
      // The owning fixture also closes the browser context during teardown.
    })
  }
}

export async function attachRetainedDiagnostics(
  context: BrowserContext,
  extensionId: string,
  testInfo: TestInfo
): Promise<void> {
  try {
    const path = testInfo.outputPath("retained-diagnostics.json")
    await readRetainedDiagnostics(context, extensionId, path)
    await testInfo.attach("retained-diagnostics", {
      path,
      contentType: "application/json",
    })
  } catch (error) {
    console.warn(
      "[extension.fixture] retained diagnostics unavailable:",
      redactDiagnostic(error)
    )
  }
}
