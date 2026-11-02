import { test, expect } from "./fixtures/extension"
import { getExtensionServiceWorker } from "./fixtures/session-rule-helpers"
import {
  openSidepanelHarness,
  seedTabContext,
  waitForActiveSeriesContextRevision,
} from "./fixtures/state-helpers"
import {
  buildExampleUrl,
  MANGADEX_TEST_SERIES_URL,
} from "./fixtures/test-domains-constants"

test("selector survives unrelated tabs and windows and closes on owning-tab navigation", async ({
  context,
  page,
  extensionId,
}) => {
  const tabId = await seedTabContext(
    page,
    context,
    {
      siteIntegrationId: "mangadex",
      mangaId: "selector-context",
      seriesTitle: "Selector Context",
      chapters: [
        { id: "chapter-1", title: "Chapter 1", url: buildExampleUrl("/ch1") },
        { id: "chapter-2", title: "Chapter 2", url: buildExampleUrl("/ch2") },
      ],
    },
    MANGADEX_TEST_SERIES_URL
  )
  const panel = await openSidepanelHarness(context, extensionId, page)
  await waitForActiveSeriesContextRevision(context, tabId)
  await panel
    .getByRole("button", { name: "Select Chapters", exact: true })
    .click()
  await panel.getByText("Chapter 1", { exact: true }).click()
  const selection = panel.locator("[data-sidepanel-inline-selection]")
  const selectedChapter = panel.getByRole("checkbox", { name: "Chapter 1" })
  await expect(selectedChapter).toBeChecked()

  // Record every collapse so a later automatic reopen cannot hide a failure.
  await panel.evaluate(() => {
    const region = document.querySelector("[data-sidepanel-inline-selection]")!
    document.documentElement.dataset.selectorCollapsed = "false"
    new MutationObserver((records) => {
      if (records.some((record) => record.oldValue === "open")) {
        document.documentElement.dataset.selectorCollapsed = "true"
      }
    }).observe(region, {
      attributes: true,
      attributeFilter: ["data-state"],
      attributeOldValue: true,
    })
  })

  const worker = await getExtensionServiceWorker(context, extensionId)
  const unrelatedTab = await worker.evaluate(
    async ({ url, tabId }) => {
      const owner = await chrome.tabs.get(tabId)
      const tab = await chrome.tabs.create({
        windowId: owner.windowId,
        active: false,
        url,
      })
      return tab.id!
    },
    { url: buildExampleUrl("/unrelated"), tabId }
  )
  await worker.evaluate(
    async ({ id, url }) => {
      await chrome.tabs.update(id, { url })
    },
    { id: unrelatedTab, url: buildExampleUrl("/redirected") }
  )
  await expect
    .poll(() =>
      worker.evaluate(
        async (id) => (await chrome.tabs.get(id)).status,
        unrelatedTab
      )
    )
    .toBe("complete")
  await expect(selection).toHaveAttribute("data-state", "open")
  await expect(selectedChapter).toBeChecked()

  const otherWindowId = await worker.evaluate(async (url) => {
    const other = await chrome.windows.create({ url, focused: false })
    const second = await chrome.tabs.create({
      windowId: other!.id,
      active: false,
      url,
    })
    await chrome.tabs.update(second.id!, { active: true })
    return other!.id!
  }, buildExampleUrl("/other-window"))
  await expect
    .poll(() =>
      worker.evaluate(async (id) => {
        const [tab] = await chrome.tabs.query({ windowId: id, active: true })
        return tab.status
      }, otherWindowId)
    )
    .toBe("complete")
  await expect(selection).toHaveAttribute("data-state", "open")
  await expect(selectedChapter).toBeChecked()
  await expect(panel.locator("html")).toHaveAttribute(
    "data-selector-collapsed",
    "false"
  )

  // Closing and reopening within the mounted panel retains its selection.
  const close = panel.getByRole("button", {
    name: "Close Selection",
    exact: true,
  })
  await close.click()
  const trigger = panel.getByRole("button", {
    name: "Select Chapters",
    exact: true,
  })
  await trigger.click()
  await expect(selectedChapter).toBeChecked()
  await close.click()
  await expect(trigger).toBeFocused()
  await trigger.click()

  await page.goto(buildExampleUrl("/owning-tab-navigation"))
  await expect(selection).toHaveAttribute("data-state", "closed")
  await expect(selection).toHaveAttribute("aria-hidden", "true")
  await expect(panel.getByRole("checkbox", { name: "Chapter 1" })).toHaveCount(
    0
  )
  await worker.evaluate(async (id) => chrome.windows.remove(id), otherWindowId)
})

test("selector closes on a new series revision and owning-window tab activation", async ({
  context,
  page,
  extensionId,
}) => {
  const chapters = [
    { id: "chapter-1", title: "Chapter 1", url: buildExampleUrl("/ch1") },
  ]
  const tabId = await seedTabContext(
    page,
    context,
    {
      siteIntegrationId: "mangadex",
      mangaId: "first-series",
      seriesTitle: "First Series",
      chapters,
    },
    MANGADEX_TEST_SERIES_URL
  )
  const panel = await openSidepanelHarness(context, extensionId, page)
  await waitForActiveSeriesContextRevision(context, tabId)
  await panel
    .getByRole("button", { name: "Select Chapters", exact: true })
    .click()
  await panel.getByText("Chapter 1", { exact: true }).click()
  const selectedChapter = panel.getByRole("checkbox", { name: "Chapter 1" })
  await expect(selectedChapter).toBeChecked()

  const response = await panel.evaluate(
    async ({ tabId, chapters, sourceUrl }) => {
      return chrome.runtime.sendMessage({
        target: "e2e",
        type: "E2E_SEED_TAB_CONTEXT",
        payload: {
          tabId,
          context: {
            context: "ready",
            sourceUrl,
            siteIntegrationId: "mangadex",
            mangaId: "second-series",
            seriesTitle: "Second Series",
            chapters,
          },
        },
      }) as Promise<{ success: boolean }>
    },
    { tabId, chapters, sourceUrl: MANGADEX_TEST_SERIES_URL }
  )
  expect(response.success).toBe(true)
  await expect(panel.getByText("Second Series", { exact: true })).toBeVisible()
  const selection = panel.locator("[data-sidepanel-inline-selection]")
  await expect(selection).toHaveAttribute("data-state", "closed")
  await panel
    .getByRole("button", { name: "Select Chapters", exact: true })
    .click()
  await expect(selectedChapter).not.toBeChecked()
  await panel.getByText("Chapter 1", { exact: true }).click()
  await expect(selectedChapter).toBeChecked()

  const worker = await getExtensionServiceWorker(context, extensionId)
  const otherTabId = await worker.evaluate(
    async ({ tabId, url }) => {
      const owner = await chrome.tabs.get(tabId)
      const other = await chrome.tabs.create({
        windowId: owner.windowId,
        active: true,
        url,
      })
      return other.id!
    },
    { tabId, url: buildExampleUrl("/another-tab") }
  )
  await expect(selection).toHaveAttribute("data-state", "closed")
  await worker.evaluate(
    async (id) => chrome.tabs.update(id, { active: true }),
    tabId
  )
  await expect(panel.getByText("Second Series", { exact: true })).toBeVisible()
  await expect(selection).toHaveAttribute("data-state", "closed")
  await panel
    .getByRole("button", { name: "Select Chapters", exact: true })
    .click()
  await expect(selectedChapter).toBeChecked()
  await worker.evaluate(async (id) => chrome.tabs.remove(id), otherTabId)
})
