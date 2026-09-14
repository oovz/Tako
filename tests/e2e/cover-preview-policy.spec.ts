import type { Request } from "@playwright/test"
import { test, expect } from "./fixtures/extension"
import { buildExampleUrl } from "./fixtures/test-domains-constants"
import { getTabId } from "./fixtures/state-helpers"
import {
  makeChapter,
  makeTask,
  seedGlobalQueue,
} from "./fixtures/queue-test-helpers"
import {
  cloneSmallPngBytes,
  SMALL_PNG_MIME_TYPE,
} from "./fixtures/mock-data/shared"

const previewUrl = "https://preview.example.com/covers/series.png"

test("queue cover previews send browser cookies and follow redirects without forwarding the original host cookie", async ({
  context,
  extensionId,
  page,
  _extensionContextState,
}) => {
  const server = _extensionContextState.localMockServer
  if (!server)
    throw new Error("This test requires the deterministic image server")
  const redirectedPreviewUrl = `${server.url}/preview-redirect/series.png`
  const receivedCookies: Array<string | undefined> = []
  server.addRoute("/preview-redirect", (request) => {
    receivedCookies.push(request.headers.cookie)
    return {
      status: 200,
      headers: { "content-type": SMALL_PNG_MIME_TYPE },
      body: cloneSmallPngBytes(),
    }
  })
  await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
  await context.addCookies([
    {
      name: "preview-session",
      value: "preview-cookie-value",
      domain: "preview.example.com",
      path: "/",
      secure: true,
      sameSite: "None",
    },
  ])
  const sidepanel = await context.newPage()
  const requests: Request[] = []
  context.on("request", (request) => {
    if (
      (request.url() === previewUrl ||
        request.url() === redirectedPreviewUrl) &&
      request.frame().page() === sidepanel
    )
      requests.push(request)
  })
  await context.route(previewUrl, (route) =>
    route.fulfill({
      status: 302,
      headers: { location: redirectedPreviewUrl },
    })
  )
  // The public URL is fulfilled above; its redirect stays on the fixture server.
  await _extensionContextState.backgroundWorker.evaluate(async (url) => {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: 9800,
          priority: 100,
          action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
          condition: {
            urlFilter: `|${url}|`,
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.IMAGE],
          },
        },
      ],
    })
  }, previewUrl)
  await seedGlobalQueue(context, [
    makeTask({
      id: "covered-download",
      seriesTitle: "Covered Series",
      status: "queued",
      created: Date.now(),
      seriesCoverUrl: previewUrl,
      chapters: [makeChapter(buildExampleUrl("/chapter"), "queued")],
    }),
  ])
  await getTabId(page, context)
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded",
  })

  await expect(sidepanel.getByText("Covered Series")).toBeVisible()
  const image = sidepanel.locator("img").filter({ visible: true })
  await expect(image).toHaveAttribute("src", previewUrl)
  await expect(image).toHaveJSProperty("naturalWidth", 1)
  expect(requests).toHaveLength(2)
  const [initial, redirected] = requests
  expect(initial.url()).toBe(previewUrl)
  expect(redirected.url()).toBe(redirectedPreviewUrl)
  expect(redirected.redirectedFrom()).toBe(initial)
  expect(initial.frame().url()).toContain(
    `chrome-extension://${extensionId}/sidepanel.html`
  )
  expect((await initial.allHeaders()).cookie).toBe(
    "preview-session=preview-cookie-value"
  )
  expect((await redirected.allHeaders()).cookie).toBeUndefined()
  expect(receivedCookies.length).toBeGreaterThan(0)
  expect(receivedCookies.every((cookie) => cookie === undefined)).toBe(true)
})
