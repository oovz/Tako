import { test, expect } from "./fixtures/extension"
import {
  getSessionState,
  getTabId,
  openSidepanelHarness,
} from "./fixtures/state-helpers"
import {
  BASIC_SERIES,
  BASIC_SERIES_PAGE_HTML,
} from "./fixtures/mock-data/site-integrations/manhuagui"
import { MANHUAGUI_LOCAL_PREFIX } from "./fixtures/mock-data/site-integrations/manhuagui/local-server"
import { MANHUAGUI_BASE_URL } from "./fixtures/test-domains-constants"

for (const recovery of ["automatic", "user retry"] as const) {
  test(`series context recovers through ${recovery} after provider failure`, async ({
    context,
    page,
    extensionId,
    _extensionContextState,
  }) => {
    const server = _extensionContextState.localMockServer
    expect(server).not.toBeNull()
    let available = false
    let requests = 0
    server!.addRoute(
      `${MANHUAGUI_LOCAL_PREFIX}/comic/${BASIC_SERIES.series.seriesId}`,
      () => {
        requests += 1
        return {
          status: available ? 200 : 503,
          headers: { "content-type": "text/html; charset=utf-8" },
          body: available
            ? BASIC_SERIES_PAGE_HTML
            : "Provider temporarily unavailable",
        }
      }
    )
    await page.goto(
      `${MANHUAGUI_BASE_URL}/comic/${BASIC_SERIES.series.seriesId}/`,
      { waitUntil: "load" }
    )
    const tabId = await getTabId(page, context)
    await expect
      .poll(() => getSessionState(context, `seriesContextError_${tabId}`))
      .toBeTruthy()
    const initialRequests = requests
    expect(initialRequests).toBeGreaterThan(0)
    if (recovery === "automatic") available = true
    const sidepanel = await openSidepanelHarness(context, extensionId, page)
    if (recovery === "user retry") {
      await expect.poll(() => requests).toBe(initialRequests + 1)
      const retry = sidepanel.getByRole("button", {
        name: "Retry series",
        exact: true,
      })
      await expect(retry).toBeVisible()
      available = true
      await retry.click()
    }
    await expect(
      sidepanel.getByText(BASIC_SERIES.series.seriesTitle, { exact: true })
    ).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => {
        const state = await getSessionState<{
          seriesTitle?: string
          chapters?: unknown[]
          chaptersLoading?: boolean
        }>(context, `tab_${tabId}`)
        return (
          state?.seriesTitle === BASIC_SERIES.series.seriesTitle &&
          state?.chaptersLoading !== true &&
          (state.chapters?.length ?? 0) > 0
        )
      })
      .toBe(true)
    const recoveryRequests = requests - initialRequests
    expect(recoveryRequests).toBeGreaterThanOrEqual(1)
    expect(
      await getSessionState(context, `seriesContextError_${tabId}`)
    ).toBeUndefined()
  })
}
