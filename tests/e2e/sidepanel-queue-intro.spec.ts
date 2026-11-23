import { test, expect } from "./fixtures/extension"
import { openSidepanelHarness } from "./fixtures/state-helpers"
import {
  MANGADEX_TEST_SERIES_URL,
  buildExampleUrl,
} from "./fixtures/test-domains-constants"

// Regression: URL changes must not blink the Queue intro paragraph or move
// the "In progress" heading. Each navigation produces transient
// {loading:true} tab-context projections; the intro must keep its last
// settled text instead of unmounting.

interface BlinkRecorder {
  removals: number
  tops: number[]
  stop: () => void
}

declare global {
  interface Window {
    __blink?: BlinkRecorder
  }
}

async function installBlinkRecorder(sp: import("@playwright/test").Page) {
  await sp.evaluate(() => {
    window.__blink?.stop()
    const panel = document.getElementById("panel-view-queue")
    if (!panel) throw new Error("panel-view-queue not found")
    const rec: BlinkRecorder = { removals: 0, tops: [], stop: () => {} }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== "childList" || record.target !== panel) continue
        for (const node of record.removedNodes) {
          if (node instanceof Element && node.matches("p.panel-empty")) {
            rec.removals += 1
          }
        }
      }
    })
    observer.observe(panel, { childList: true })
    let raf = 0
    const frame = () => {
      const heading = panel.querySelector(".queue-region .queue-section-label")
      if (heading) rec.tops.push(heading.getBoundingClientRect().top)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    rec.stop = () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
    window.__blink = rec
  })
}

async function readBlink(sp: import("@playwright/test").Page) {
  return await sp.evaluate(() => {
    const rec = window.__blink
    return {
      removals: rec?.removals ?? -1,
      top: rec?.tops.length ? rec.tops[rec.tops.length - 1] : null,
      minTop: rec?.tops.length ? Math.min(...rec.tops) : null,
      maxTop: rec?.tops.length ? Math.max(...rec.tops) : null,
    }
  })
}

async function resetBlink(sp: import("@playwright/test").Page) {
  await sp.evaluate(() => {
    if (window.__blink) {
      window.__blink.removals = 0
      window.__blink.tops = []
    }
  })
}

async function waitForContextSettled(
  sp: import("@playwright/test").Page,
  opts: { requireNonLoading?: boolean } = {}
) {
  await sp.evaluate(
    async ({ requireNonLoading }) => {
      const win = await chrome.windows.getCurrent()
      const winKey = String(win.id)
      const readState = async () => {
        const data = await chrome.storage.session.get(
          "activeTabContextByWindow"
        )
        const entry = (
          data as Record<
            string,
            Record<
              string,
              { revision?: number; context?: Record<string, unknown> | null }
            >
          >
        )["activeTabContextByWindow"]?.[winKey]
        const ctx = entry?.context
        let kind = "missing"
        if (entry !== undefined) {
          if (ctx == null) kind = "unsupported"
          else if (ctx["loading"] === true) kind = "loading"
          else if (typeof ctx["error"] === "string") kind = "error"
          else if (Array.isArray(ctx["chapters"])) kind = "ready"
        }
        return { revision: entry?.revision ?? -1, kind }
      }
      const deadline = Date.now() + 25_000
      let last = await readState()
      let stableSince = Date.now()
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        const state = await readState()
        const settled =
          state.revision === last.revision &&
          state.kind === last.kind &&
          (!requireNonLoading || state.kind !== "loading")
        if (!settled) {
          last = state
          stableSince = Date.now()
        } else if (Date.now() - stableSince >= 500) {
          return
        }
      }
    },
    { requireNonLoading: opts.requireNonLoading ?? false }
  )
}

async function introCount(sp: import("@playwright/test").Page) {
  return await sp.locator("#panel-view-queue > p.panel-empty").count()
}

test.describe("queue intro stability across URL changes", () => {
  test("full navigation between unsupported pages keeps the intro mounted", async ({
    context,
    extensionId,
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    await page.bringToFront()
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await installBlinkRecorder(sp)
    await waitForContextSettled(sp)
    await expect.poll(async () => (await readBlink(sp)).top).not.toBeNull()
    await resetBlink(sp)
    await expect.poll(async () => (await readBlink(sp)).top).not.toBeNull()
    const before = await readBlink(sp)
    expect(before.removals).toBe(0)
    expect(before.top).not.toBeNull()
    expect(await introCount(sp)).toBe(1)

    await page.goto(buildExampleUrl("/other"), {
      waitUntil: "domcontentloaded",
    })
    await waitForContextSettled(sp, { requireNonLoading: true })
    // Let a few frames elapse so any delayed remount is observed.
    await sp.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))

    const after = await readBlink(sp)
    expect(after.removals).toBe(0)
    expect(Math.abs((after.top ?? 0) - (before.top ?? 0))).toBeLessThan(1)
    expect(after.minTop).toBe(after.maxTop)
    expect(await introCount(sp)).toBe(1)
    await sp.close()
  })

  test("pushState on an unsupported page keeps the intro mounted", async ({
    context,
    extensionId,
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    await page.bringToFront()
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await installBlinkRecorder(sp)
    await waitForContextSettled(sp)
    await expect.poll(async () => (await readBlink(sp)).top).not.toBeNull()
    await resetBlink(sp)
    await expect.poll(async () => (await readBlink(sp)).top).not.toBeNull()
    const before = await readBlink(sp)
    expect(before.top).not.toBeNull()

    await page.evaluate(() => {
      history.pushState({}, "", "/pushed")
    })
    await waitForContextSettled(sp, { requireNonLoading: true })
    await sp.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))

    const after = await readBlink(sp)
    expect(after.removals).toBe(0)
    expect(Math.abs((after.top ?? 0) - (before.top ?? 0))).toBeLessThan(1)
    expect(after.minTop).toBe(after.maxTop)
    expect(await introCount(sp)).toBe(1)
    await sp.close()
  })

  test("intro hides while a supported series context is active", async ({
    context,
    extensionId,
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    await page.bringToFront()
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByRole("tab", { name: "Manga" })).toHaveCount(0)
    await expect(sp.locator("#panel-view-queue > p.panel-empty")).toHaveCount(1)

    await page.goto(MANGADEX_TEST_SERIES_URL, {
      waitUntil: "domcontentloaded",
    })
    await expect(sp.getByRole("tab", { name: "Manga" })).toBeVisible({
      timeout: 20000,
    })
    await waitForContextSettled(sp, { requireNonLoading: true })
    await expect(sp.locator("#panel-view-queue > p.panel-empty")).toHaveCount(0)
    await sp.close()
  })
})
