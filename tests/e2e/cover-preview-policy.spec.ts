import type { BrowserContext, Locator, Page, Worker } from "@playwright/test"
import { readFileSync } from "node:fs"
import { test, expect, resolveBackgroundWorker } from "./fixtures/extension"
import { buildExampleUrl } from "./fixtures/test-domains-constants"
import {
  getSessionState,
  getTabId,
  openSidepanelHarness,
  reloadSidepanelHarness,
  waitForTabSeriesTitle,
} from "./fixtures/state-helpers"
import { makeChapter, makeTask } from "./fixtures/queue-test-helpers"
import { mycomicFixture } from "./fixtures/mock-data/site-integrations/mycomic/routes"
import { PAGE_PNG } from "./fixtures/mock-data/site-integrations/expanded-site-fixture"
import type { LocalMockServerHandle } from "./fixtures/local-mock-server"
import type { DownloadTaskState } from "../../src/domain/queue/state"

const coverUrl = "https://biccam.com/comics/35937-2e233f.jpg"
const expectedReferer = "https://mycomic.com/"
const coverPrefix = "/__expanded/mycomic/1/comics"

async function requireProviderReferer(worker: Worker): Promise<void> {
  // DNR redirects change the fixture request's domain to loopback. Apply the
  // integration's fetch header policy there; production-domain matching is
  // exercised separately by the integration enablement tests.
  await worker.evaluate(async (referer) => {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: 9800,
          priority: 200,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: "Referer",
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: referer,
              },
            ],
          },
          condition: {
            requestDomains: ["biccam.com", "127.0.0.1"],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              chrome.declarativeNetRequest.ResourceType.OTHER,
            ],
          },
        },
      ],
    })
  }, expectedReferer)
}

function serveCover(
  server: LocalMockServerHandle,
  observe: (referer: string | undefined) => void,
  response: { status: number; body: Buffer | string } = {
    status: 200,
    body: PAGE_PNG,
  }
): void {
  server.addRoute(coverPrefix, ({ headers }) => {
    const referer = headers.referer
    observe(referer)
    if (referer !== expectedReferer)
      return { status: 403, body: "Referer is required" }
    return {
      ...response,
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    }
  })
}

async function expectDecodedCover(image: Locator): Promise<void> {
  await expect(image).toHaveAttribute("src", /^blob:/)
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete &&
          element.naturalWidth === 26 &&
          element.naturalHeight === 2
      )
    )
    .toBe(true)
}

async function stopBackgroundWorker(
  context: BrowserContext,
  panel: Page,
  extensionId: string
): Promise<void> {
  const session = await context.newCDPSession(panel)
  let runningVersionId: string | undefined
  const stoppedVersions = new Set<string>()
  session.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const version of versions) {
      if (
        version.scriptURL !== `chrome-extension://${extensionId}/background.js`
      )
        continue
      if (version.runningStatus === "running")
        runningVersionId = version.versionId
      if (version.runningStatus === "stopped")
        stoppedVersions.add(version.versionId)
    }
  })
  try {
    await session.send("ServiceWorker.enable")
    await expect.poll(() => runningVersionId).toBeTruthy()
    const versionId = runningVersionId!
    await session.send("ServiceWorker.stopWorker", { versionId })
    await expect.poll(() => stoppedVersions.has(versionId)).toBe(true)
  } finally {
    await session.detach()
  }
}

async function seedTasksFromPanel(
  panel: Page,
  tasks: DownloadTaskState[]
): Promise<void> {
  const response = await panel.evaluate(
    async (downloadQueue) =>
      await chrome.runtime.sendMessage({
        target: "e2e",
        type: "E2E_SEED_DOWNLOAD_QUEUE",
        payload: { downloadQueue },
      }),
    tasks
  )
  expect(response).toEqual({ success: true })
}

test("current series cover decodes fetched bytes using the integration Referer policy", async ({
  context,
  extensionId,
  page,
  _extensionContextState,
}) => {
  const server = _extensionContextState.localMockServer!
  const referers: Array<string | undefined> = []
  serveCover(server, (referer) => referers.push(referer))
  await requireProviderReferer(_extensionContextState.backgroundWorker)
  const fixture = mycomicFixture.testCase
  await page.goto(fixture.seriesUrl, { waitUntil: "domcontentloaded" })
  const tabId = await getTabId(page, context)
  await waitForTabSeriesTitle(context, tabId, fixture.title)
  const panel = await openSidepanelHarness(context, extensionId, page)
  try {
    await expect.poll(() => referers.length).toBeGreaterThan(0)
    await expectDecodedCover(panel.getByRole("img", { name: fixture.title }))
    expect(referers.every((referer) => referer === expectedReferer)).toBe(true)
    const state = await getSessionState<{ metadata?: { coverUrl?: string } }>(
      context,
      `tab_${tabId}`
    )
    expect(state?.metadata?.coverUrl).toBe(coverUrl)
    await _extensionContextState.backgroundWorker.evaluate(async () => {
      await chrome.offscreen.closeDocument()
    })
    const image = panel.getByRole("img", { name: fixture.title })
    await expectDecodedCover(image)
    expect(
      await image.evaluate(
        async (element: HTMLImageElement) =>
          (await (await fetch(element.src)).arrayBuffer()).byteLength
      )
    ).toBe(PAGE_PNG.byteLength)
    const originalBlob = await image.getAttribute("src")
    await stopBackgroundWorker(context, panel, extensionId)
    await expectDecodedCover(image)
    await expect(image).toHaveAttribute("src", originalBlob!)
    expect(
      await image.evaluate(
        async (element: HTMLImageElement) =>
          (await (await fetch(element.src)).arrayBuffer()).byteLength
      )
    ).toBe(PAGE_PNG.byteLength)
    await reloadSidepanelHarness(panel, page)
    _extensionContextState.backgroundWorker =
      await resolveBackgroundWorker(context)
    await expectDecodedCover(image)
    await expect(image).not.toHaveAttribute("src", originalBlob!)
  } finally {
    await panel.close()
  }
})

for (const response of [
  { name: "HTTP failure", status: 403, body: "Access denied" },
  { name: "invalid raster bytes", status: 200, body: "This is not an image" },
]) {
  test(`current series cover settles to a fallback after ${response.name}`, async ({
    context,
    extensionId,
    page,
    _extensionContextState,
  }) => {
    serveCover(_extensionContextState.localMockServer!, () => {}, response)
    await requireProviderReferer(_extensionContextState.backgroundWorker)
    const fixture = mycomicFixture.testCase
    await page.goto(fixture.seriesUrl, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)
    await waitForTabSeriesTitle(context, tabId, fixture.title)
    const panel = await openSidepanelHarness(context, extensionId, page)
    try {
      const image = panel.getByRole("img", { name: fixture.title })
      await expect(image).toHaveAttribute("src", /\/icon\/128\.png$/)
      await expect(
        panel.locator('[data-preview-state="fallback"]')
      ).toHaveAttribute("aria-busy", "false")
      await expect(image).toHaveJSProperty("naturalWidth", 128)
    } finally {
      await panel.close()
    }
  })
}

test("shares covers across queue and history rows and reloads them when the panel reopens", async ({
  context,
  extensionId,
  page,
  _extensionContextState,
}) => {
  const referers: Array<string | undefined> = []
  serveCover(_extensionContextState.localMockServer!, (referer) =>
    referers.push(referer)
  )
  await requireProviderReferer(_extensionContextState.backgroundWorker)
  await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
  let panel = await openSidepanelHarness(context, extensionId, page)
  const now = Date.now()
  const tasks = [
    makeTask({
      id: "covered-queue",
      siteIntegrationId: "mycomic",
      mangaId: "35937",
      seriesTitle: "Queued cover",
      status: "queued",
      created: now,
      seriesCoverUrl: coverUrl,
      chapters: [
        makeChapter("https://mycomic.com/cn/chapters/492177", "queued"),
      ],
    }),
    makeTask({
      id: "covered-history",
      siteIntegrationId: "mycomic",
      mangaId: "35937",
      seriesTitle: "Saved cover",
      status: "completed",
      created: now - 2000,
      completed: now - 1000,
      seriesCoverUrl: coverUrl,
      chapters: [
        makeChapter("https://mycomic.com/cn/chapters/492177", "completed"),
      ],
    }),
  ]
  try {
    await seedTasksFromPanel(panel, tasks)
    const queuedRow = panel
      .locator("div.group.relative")
      .filter({ hasText: "Queued cover" })
    const historyRow = panel
      .locator("div.group.relative")
      .filter({ hasText: "Saved cover" })
    await expectDecodedCover(queuedRow.locator("img"))
    await expectDecodedCover(historyRow.locator("img"))
    const sharedUrl = await queuedRow.locator("img").getAttribute("src")
    await expect(historyRow.locator("img")).toHaveAttribute("src", sharedUrl!)
    await _extensionContextState.backgroundWorker.evaluate(async () => {
      await chrome.offscreen.closeDocument()
    })
    await expectDecodedCover(queuedRow.locator("img"))
    await expectDecodedCover(historyRow.locator("img"))
    expect(
      await queuedRow
        .locator("img")
        .evaluate(
          async (element: HTMLImageElement) =>
            (await (await fetch(element.src)).arrayBuffer()).byteLength
        )
    ).toBe(PAGE_PNG.byteLength)
    const initialRequests = referers.length
    expect(initialRequests).toBeGreaterThan(0)
    expect(referers.every((referer) => referer === expectedReferer)).toBe(true)
    await seedTasksFromPanel(panel, [
      ...tasks,
      {
        ...tasks[0],
        id: "covered-second-consumer",
        seriesTitle: "Second consumer",
      },
    ])
    const additionalImage = panel
      .locator("div.group.relative")
      .filter({ hasText: "Second consumer" })
      .locator("img")
    await expectDecodedCover(additionalImage)
    await expect(additionalImage).toHaveAttribute("src", sharedUrl!)
    expect(referers).toHaveLength(initialRequests)

    await historyRow
      .getByRole("button", { name: "Remove", exact: true })
      .click()
    await expect(historyRow).toHaveCount(0)
    await expectDecodedCover(queuedRow.locator("img"))
    await expect(queuedRow.locator("img")).toHaveAttribute("src", sharedUrl!)

    await panel.close()
    panel = await openSidepanelHarness(context, extensionId, page)
    const restored = panel
      .locator("div.group.relative")
      .filter({ hasText: "Queued cover" })
      .locator("img")
    await expectDecodedCover(restored)
    await expect(restored).not.toHaveAttribute("src", sharedUrl!)
    expect(referers.length).toBeGreaterThan(initialRequests)
    expect(referers.every((referer) => referer === expectedReferer)).toBe(true)
  } finally {
    await panel.close()
  }
})

test("a delayed cover from an earlier series cannot replace the current series image", async ({
  context,
  extensionId,
  page,
  _extensionContextState,
}) => {
  const server = _extensionContextState.localMockServer!
  await requireProviderReferer(_extensionContextState.backgroundWorker)
  const firstUrl = "https://mycomic.com/cn/comics/70001"
  const secondUrl = "https://mycomic.com/cn/comics/70002"
  const firstCover = "https://biccam.com/comics/70001-fixture.png"
  const secondCover = "https://biccam.com/comics/70002-fixture.png"
  const delayed = Promise.withResolvers<void>()
  let firstRequested = false
  let secondRequested = false
  const capturedHtml = readFileSync(
    new URL(
      "../fixtures/site-integrations/mycomic/series.html",
      import.meta.url
    ),
    "utf8"
  )
  const seriesHtml = (id: string, title: string, image: string) =>
    capturedHtml
      .replaceAll("35937", id)
      .replaceAll("葬送者芙莉莲", title)
      .replace(
        /<meta property="og:image"[^>]*>/,
        `<meta property="og:image" content="${image}">`
      )
  const firstHtml = seriesHtml("70001", "Earlier series", firstCover)
  const secondHtml = seriesHtml("70002", "Current series", secondCover)
  for (const [url, html] of [
    [firstUrl, firstHtml],
    [secondUrl, secondHtml],
  ]) {
    await context.route(url, (route) =>
      route.fulfill({ contentType: "text/html", body: html })
    )
    server.addRoute(`/__expanded/mycomic/0${new URL(url).pathname}`, () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: html,
    }))
  }
  server.addRoute(coverPrefix, async ({ pathnameAfterPrefix, headers }) => {
    if (headers.referer !== expectedReferer)
      return { status: 403, body: "Referer is required" }
    if (pathnameAfterPrefix === "/70001-fixture.png") {
      firstRequested = true
      await delayed.promise
    } else {
      secondRequested = true
    }
    return {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "no-store" },
      body: PAGE_PNG,
    }
  })
  await page.goto(firstUrl, { waitUntil: "domcontentloaded" })
  const tabId = await getTabId(page, context)
  await waitForTabSeriesTitle(context, tabId, "Earlier series")
  const panel = await openSidepanelHarness(context, extensionId, page)
  try {
    await expect.poll(() => firstRequested).toBe(true)
    await page.goto(secondUrl, { waitUntil: "domcontentloaded" })
    await waitForTabSeriesTitle(context, tabId, "Current series")
    await expect.poll(() => secondRequested).toBe(true)
    const currentImage = panel.getByRole("img", { name: "Current series" })
    await expectDecodedCover(currentImage)
    const currentBlob = await currentImage.getAttribute("src")
    delayed.resolve()
    await panel.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    await expect(currentImage).toHaveAttribute("src", currentBlob!)
    await expect(
      panel.getByRole("img", { name: "Earlier series" })
    ).toHaveCount(0)
    const state = await getSessionState<{ metadata?: { coverUrl?: string } }>(
      context,
      `tab_${tabId}`
    )
    expect(state?.metadata?.coverUrl).toBe(secondCover)
  } finally {
    delayed.resolve()
    await panel.close()
  }
})

test("cover cache bounds settle excess rows and eviction releases unused Blob URLs", async ({
  context,
  extensionId,
  page,
  _extensionContextState,
}) => {
  test.setTimeout(90_000)
  serveCover(_extensionContextState.localMockServer!, () => {})
  await requireProviderReferer(_extensionContextState.backgroundWorker)
  await context.addInitScript(() => {
    const revoked: string[] = []
    Object.defineProperty(window, "previewRevokedUrls", { value: revoked })
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url) => {
      revoked.push(url)
      revoke(url)
    }
  })
  await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
  const panel = await openSidepanelHarness(context, extensionId, page)
  const now = Date.now()
  const tasks = Array.from({ length: 33 }, (_, index) =>
    makeTask({
      id: `cover-capacity-${index}`,
      siteIntegrationId: "mycomic",
      mangaId: String(80000 + index),
      seriesTitle: `Cover capacity ${index + 1}`,
      status: "queued",
      created: now + index,
      seriesCoverUrl: `https://biccam.com/comics/${80000 + index}-fixture.png`,
      chapters: [
        makeChapter("https://mycomic.com/cn/chapters/492177", "queued"),
      ],
    })
  )
  try {
    await seedTasksFromPanel(panel, tasks)
    await expect(
      panel.getByText("Cover capacity 33", { exact: true })
    ).toBeVisible()
    await expect(panel.locator('[data-preview-state="loading"]')).toHaveCount(
      0,
      {
        timeout: 35_000,
      }
    )
    const ready = panel.locator('[data-preview-state="ready"] img')
    const readyCount = await ready.count()
    expect(readyCount).toBeGreaterThan(0)
    expect(readyCount).toBeLessThanOrEqual(32)
    expect(
      await panel.locator('[data-preview-state="fallback"]').count()
    ).toBeGreaterThan(0)
    const retainedUrls = await ready.evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).src)
    )
    await seedTasksFromPanel(panel, [])
    await expect(panel.locator("[data-preview-state]")).toHaveCount(0)
    await seedTasksFromPanel(panel, [
      {
        ...tasks[0],
        id: "cover-after-eviction",
        seriesTitle: "Cover after eviction",
        seriesCoverUrl: "https://biccam.com/comics/90000-fixture.png",
      },
    ])
    await expectDecodedCover(
      panel
        .locator("div.group.relative")
        .filter({ hasText: "Cover after eviction" })
        .locator("img")
    )
    await expect
      .poll(() =>
        panel.evaluate((urls) => {
          const revoked = (
            window as unknown as { previewRevokedUrls: string[] }
          ).previewRevokedUrls
          return urls.some((url) => revoked.includes(url))
        }, retainedUrls)
      )
      .toBe(true)
    const evictedUrl = await panel.evaluate((urls) => {
      const revoked = (window as unknown as { previewRevokedUrls: string[] })
        .previewRevokedUrls
      return urls.find((url) => revoked.includes(url))!
    }, retainedUrls)
    expect(
      await panel.evaluate(
        (url) =>
          fetch(url).then(
            () => true,
            () => false
          ),
        evictedUrl
      )
    ).toBe(false)
  } finally {
    await panel.close()
  }
})
