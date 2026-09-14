import { afterEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import { resolveBackgroundWorker } from "@/tests/e2e/fixtures/extension"
import {
  waitForTabSeriesTitle,
  waitForTabStateCleared,
  waitForGlobalState,
} from "@/tests/e2e/fixtures/state-helpers"
import {
  waitForTerminalTask,
  waitForBrowserDownload,
} from "@/tests/live/fixtures/download-workflow-helpers"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("diagnostic timeout context", () => {
  it.each(["series-title", "cleared-tab", "queue"])(
    "retains final %s state in timeout diagnostics",
    async (kind) => {
      vi.stubGlobal("chrome", {
        storage: {
          session: {
            get: async () => ({
              tab_7: {
                seriesTitle: "Observed series",
                sourceUrl:
                  "https://provider.example/series?token=SYNTHETIC_TIMEOUT_SECRET",
              },
            }),
          },
          local: {
            get: async () => ({
              "settings:global": {},
              downloadQueue: [{ id: "queued-task" }],
            }),
          },
        },
        tabs: { get: async () => ({ id: 7 }) },
        action: { getTitle: async () => "Tako" },
      })
      const worker = {
        url: () => "chrome-extension://tako/background.js",
        evaluate: (fn: (argument: unknown) => unknown, argument: unknown) =>
          fn(argument),
      }
      const context = { serviceWorkers: () => [worker] }
      let failure: unknown
      try {
        if (kind === "series-title")
          await waitForTabSeriesTitle(context as never, 7, "Wanted series", {
            timeout: 1,
          })
        else if (kind === "cleared-tab")
          await waitForTabStateCleared(context as never, 7, { timeout: 1 })
        else
          await waitForGlobalState(context as never, () => false, {
            timeout: 1,
          })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain(
        kind === "queue" ? "queued-task" : "Observed series"
      )
      expect((failure as Error).message).not.toContain(
        "SYNTHETIC_TIMEOUT_SECRET"
      )
    }
  )

  it("retains worker discovery context with redacted URLs", async () => {
    const context = {
      serviceWorkers: () => [
        {
          url: () =>
            "https://provider.example/worker?token=SYNTHETIC_TIMEOUT_SECRET",
        },
      ],
      waitForEvent: async () => {
        throw new Error("no extension worker")
      },
    }
    let failure: unknown
    try {
      await resolveBackgroundWorker(context as never)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain("Tako Manga Downloader")
    expect((failure as Error).message).toContain(
      "https://provider.example/worker"
    )
    expect((failure as Error).message).not.toContain("SYNTHETIC_TIMEOUT_SECRET")
  })

  it("retains task identity and progress after a terminal wait times out", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => ({
            downloadQueue: [
              { id: "task-timeout", status: "downloading", chapters: [] },
            ],
          }),
        },
        session: {
          get: async () => ({ activeTaskProgress: { stage: "archiving" } }),
        },
      },
    })
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(180_001)
    const page = {
      evaluate: (fn: (key: string) => unknown, key: string) => fn(key),
      waitForTimeout: async () => undefined,
    }
    let failure: unknown
    try {
      await waitForTerminalTask(page as never, "task-timeout")
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain("task-timeout")
    expect((failure as Error).message).toContain("archiving")
  })

  it("retains browser-download identity and last state after timeout", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(30_001)
    const page = {
      evaluate: async () => ({
        id: 42,
        filename: tmpdir(),
        state: "in_progress",
      }),
      waitForTimeout: async () => undefined,
    }
    let failure: unknown
    try {
      await waitForBrowserDownload(page as never, 42)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain("42")
    expect((failure as Error).message).toContain("in_progress")
    expect((failure as Error).message).not.toContain(tmpdir())
  })
})
