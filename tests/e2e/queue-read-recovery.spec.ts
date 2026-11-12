import { test, expect } from "./fixtures/extension"

test.describe("Queue read recovery", () => {
  test("Side Panel retries an unavailable initial projection", async ({
    page,
    extensionId,
  }) => {
    await page.addInitScript(() => {
      const get = chrome.storage.session.get.bind(chrome.storage.session)
      const gate = Promise.withResolvers<void>()
      let allowRetry = false
      let retries = 0
      Object.defineProperty(chrome.storage.session, "get", {
        configurable: true,
        value: (keys: string | string[]) => {
          if (Array.isArray(keys) && keys.includes("queueView")) {
            if (!allowRetry) {
              return Promise.reject(new Error("Private storage details"))
            }
            document.documentElement.dataset.queueRetryReads = String(++retries)
            return gate.promise.then(() => get(keys))
          }
          return get(keys)
        },
      })
      document.addEventListener(
        "click",
        () => {
          allowRetry = true
        },
        { once: true, capture: true }
      )
      document.addEventListener("test-release-queue-retry", () =>
        gate.resolve()
      )
    })
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
    await expect(page.getByRole("alert")).toContainText(
      "Queue and task history could not be loaded."
    )
    const header = page.getByRole("banner")
    await expect(header).toContainText(/—\s*queued/)
    await expect(page.getByText("Private storage details")).toHaveCount(0)
    const retry = page.getByRole("button", { name: "Retry", exact: true })
    await retry.click()
    await expect(retry).toHaveAttribute("aria-busy", "true")
    await expect(retry).toBeFocused()
    await expect(page.getByRole("alert")).toContainText(
      "Queue and task history could not be loaded."
    )
    await retry.dispatchEvent("click")
    await expect(page.locator("html")).toHaveAttribute(
      "data-queue-retry-reads",
      "1"
    )
    await page.evaluate(() =>
      document.dispatchEvent(new Event("test-release-queue-retry"))
    )
    await expect(header).toContainText(/0\s*queued/)
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expect(page.getByRole("tab", { name: "Queue" })).toBeFocused()
  })

  test("Side Panel preserves known rows through a malformed projection and recovers", async ({
    page,
    extensionId,
  }) => {
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
    const header = page.getByRole("banner")
    await expect(header).toContainText(/0\s*queued/)
    await page.evaluate(async () => {
      await chrome.storage.session.set({
        queueView: [
          {
            destination: { kind: "downloads-api" },
            id: "active",
            seriesKey: "mangadex#active",
            seriesTitle: "Known active series",
            siteIntegration: "mangadex",
            status: "downloading",
            chapters: { total: 1, completed: 0, unsuccessful: 0 },
            timestamps: { created: 1, started: 2 },
          },
          {
            destination: { kind: "downloads-api" },
            id: "known",
            seriesKey: "mangadex#known",
            seriesTitle: "Known queued series",
            siteIntegration: "mangadex",
            status: "queued",
            chapters: { total: 1, completed: 0, unsuccessful: 0 },
            timestamps: { created: 1 },
          },
        ],
        historyView: [],
      })
    })
    const active = page.getByText("Known active series")
    const queued = page.getByText("Known queued series")
    await expect(active).toBeVisible()
    await expect(queued).toBeVisible()
    const activeTop = (await active.boundingBox())!.y
    const queuedTop = (await queued.boundingBox())!.y
    const motion = await page.evaluate(async () => {
      const strip = document.querySelector<HTMLElement>(".queue-panel-notice")!
      const body = strip.querySelector<HTMLElement>(".queue-panel-notice-body")!
      const motion = new Promise<{
        height: number
        fullHeight: number
        offset: number
      } | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000)
        strip.addEventListener("transitionrun", (event) => {
          if (
            event.target !== strip ||
            event.propertyName !== "grid-template-rows"
          )
            return
          clearTimeout(timer)
          const resize = strip.getAnimations()[0]
          const slide = body.getAnimations()[0]
          if (!resize || !slide) {
            resolve(null)
            return
          }
          // Sample the same point in both transitions without depending on frame timing.
          for (const animation of [resize, slide]) {
            animation.pause()
            animation.currentTime =
              Number(animation.effect?.getTiming().duration) / 2
          }
          const bounds = strip.getBoundingClientRect()
          const content = body.getBoundingClientRect()
          resolve({
            height: bounds.height,
            fullHeight: content.height,
            offset: content.top - bounds.top,
          })
          resize.finish()
          slide.finish()
        })
      })
      await chrome.storage.session.set({ queueView: [{ malformed: true }] })
      return motion
    })
    expect(motion).not.toBeNull()
    expect(motion!.height).toBeGreaterThan(0)
    expect(motion!.height).toBeLessThan(motion!.fullHeight)
    expect(motion!.offset).toBeLessThan(0)
    expect(motion!.height).toBeCloseTo(motion!.fullHeight + motion!.offset, 0)
    const notice = page.getByRole("alert")
    await expect(notice).toContainText(
      "Queue and task history may be out of date."
    )
    await expect
      .poll(async () => (await active.boundingBox())?.y)
      .toBeGreaterThan(activeTop)
    await expect
      .poll(async () => (await queued.boundingBox())?.y)
      .toBeGreaterThan(queuedTop)
    await expect(header).toContainText(/1\s*queued/)
    await page.getByRole("tab", { name: "Recent" }).click()
    await expect(notice).toHaveCount(0)
    await page.getByRole("tab", { name: "Queue" }).click()
    await expect(notice).toBeVisible()
    await page.evaluate(async () => {
      await chrome.storage.session.set({ queueView: [], historyView: [] })
    })
    await expect(header).toContainText(/0\s*queued/)
    await expect(queued).toHaveCount(0)
    await expect(page.getByRole("alert")).toHaveCount(0)
  })

  test("Options retries an unavailable task view", async ({
    page,
    extensionId,
  }) => {
    await page.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime)
      Object.defineProperty(chrome.runtime, "sendMessage", {
        configurable: true,
        value: (message: { type: string }) =>
          message.type === "GET_OPTIONS_DOWNLOAD_STATE"
            ? Promise.reject(new Error("Private transport details"))
            : send(message),
      })
      document.addEventListener(
        "click",
        (event) => {
          if (
            (event.target as Element).closest("button")?.textContent?.trim() ===
            "Retry"
          ) {
            Object.defineProperty(chrome.runtime, "sendMessage", {
              value: send,
            })
          }
        },
        { capture: true }
      )
    })
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=activity`
    )
    await expect(page.getByRole("alert")).toContainText(
      "Queue and task history could not be loaded."
    )
    await expect(
      page.getByRole("heading", { name: "No download tasks" })
    ).toHaveCount(0)
    await expect(page.getByText("Private transport details")).toHaveCount(0)
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "No download tasks" })
    ).toBeVisible()
    await expect(page.getByRole("alert")).toHaveCount(0)
  })
})
