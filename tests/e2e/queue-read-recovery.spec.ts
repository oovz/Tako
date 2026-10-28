import { test, expect } from "./fixtures/extension"

test.describe("Queue read recovery", () => {
  test("Side Panel retries an unavailable initial projection", async ({
    page,
    extensionId,
  }) => {
    await page.addInitScript(() => {
      const get = chrome.storage.session.get.bind(chrome.storage.session)
      Object.defineProperty(chrome.storage.session, "get", {
        configurable: true,
        value: (keys: string | string[]) => {
          if (Array.isArray(keys) && keys.includes("queueView")) {
            return Promise.reject(new Error("Private storage details"))
          }
          return get(keys)
        },
      })
      document.addEventListener(
        "click",
        () => {
          Object.defineProperty(chrome.storage.session, "get", { value: get })
        },
        { once: true, capture: true }
      )
    })
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
    await expect(page.getByRole("alert")).toContainText(
      "Queue and task history could not be loaded."
    )
    await expect(page.getByText("No downloads yet")).toHaveCount(0)
    await expect(page.getByText("Private storage details")).toHaveCount(0)
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(page.getByText("No downloads yet")).toBeVisible()
    await expect(page.getByRole("alert")).toHaveCount(0)
  })

  test("Side Panel preserves known rows through a malformed projection and recovers", async ({
    page,
    extensionId,
  }) => {
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
    await expect(page.getByText("No downloads yet")).toBeVisible()
    await page.evaluate(async () => {
      await chrome.storage.session.set({
        queueView: [
          {
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
    await expect(page.getByText("Known queued series")).toBeVisible()
    await page.evaluate(async () => {
      await chrome.storage.session.set({ queueView: [{ malformed: true }] })
    })
    await expect(page.getByRole("alert")).toContainText(
      "Queue and task history may be out of date."
    )
    await expect(page.getByText("Known queued series")).toBeVisible()
    await expect(page.getByText("No downloads yet")).toHaveCount(0)
    await page.evaluate(async () => {
      await chrome.storage.session.set({ queueView: [], historyView: [] })
    })
    await expect(page.getByText("No downloads yet")).toBeVisible()
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
    await expect(page.getByText("No downloads yet")).toHaveCount(0)
    await expect(page.getByText("Private transport details")).toHaveCount(0)
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(page.getByText("No downloads yet")).toBeVisible()
    await expect(page.getByRole("alert")).toHaveCount(0)
  })
})
