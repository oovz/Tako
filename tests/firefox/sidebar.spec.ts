import { readdir } from "node:fs/promises"
import type { RuntimeMessageRequest } from "../../src/runtime/runtime-message-contracts"
import { expect, test } from "./extension"
import { mangaMillionSeries } from "./mangamillion-fixture"

test("opens the active series from the toolbar and blocks named container tabs", async ({
  extension,
}) => {
  expect(
    await extension.firefox.execute("return SidebarController.isOpen")
  ).toBe(false)
  await extension.openSidebar()
  await extension.selectManga()
  await expect
    .poll(extension.sidebarText, { timeout: 12_000 })
    .toContain("One Piece")
  await expect.poll(extension.sidebarText).toContain("Romance Dawn")
  const priorSelection = await extension.sidebar<
    RuntimeMessageRequest<"START_DOWNLOAD">["payload"]
  >(`
      return (async () => {
        const { id: windowId } = await chrome.windows.getCurrent();
        const { activeTabContextByWindow } = await chrome.storage.session.get("activeTabContextByWindow");
        const { context, revision, activeTabId } = activeTabContextByWindow[windowId];
        const chapter = context.chapters.find(chapter => chapter.title.includes("Romance Dawn"));
        return {
          sourceWindowId: windowId,
          sourceTabId: activeTabId,
          sourceUrl: context.sourceUrl,
          siteIntegrationId: context.siteIntegrationId,
          seriesId: context.mangaId,
          seriesRevision: revision,
          selectedChapterIds: [chapter.id],
        };
      })();
    `)

  await extension.navigate(mangaMillionSeries, "container")
  await extension.selectManga()
  await expect
    .poll(extension.sidebarText)
    .toContain("Open this series in Firefox’s default container")
  // A request carrying the prior selection still reaches background authority.
  const attempt = await extension.sidebar(`
      return (async () => {
        const payload = ${JSON.stringify(priorSelection)};
        const [tab] = await chrome.tabs.query({ active: true, windowId: payload.sourceWindowId });
        payload.sourceTabId = tab.id;
        return chrome.runtime.sendMessage({
          target: "background", type: "START_DOWNLOAD",
          commandId: crypto.randomUUID(), issuedAt: Date.now(), payload,
        });
      })();
    `)
  expect(attempt).toMatchObject({
    success: false,
    code: "stale_series_context",
  })
  expect(
    await extension.sidebar(
      "return !!document.querySelector('button[aria-label^=Download]')"
    )
  ).toBe(false)
  await extension.clickSidebar("#panel-tab-queue")
  await expect.poll(extension.sidebarText).toContain("No active downloads.")
  expect(await readdir(extension.downloadsDirectory)).toEqual([])
})
