import { mkdir, readFile } from "node:fs/promises"

import { test, expect } from "./fixtures/extension"

const outputBytes = 32 * 1024 * 1024
const outputByte = 73

test("retains Blob output through acceptance and releases it after Chrome consumption stops", async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const directory = testInfo.outputPath("blob-downloads")
  await mkdir(directory, { recursive: true })
  const browser = await context.newCDPSession(page)
  await browser.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: directory,
    eventsEnabled: true,
  })

  for (const action of ["complete", "cancel", "erase"] as const) {
    const accepted = await page.evaluate(
      async ({ action, outputBytes, outputByte }) => {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(outputBytes).fill(outputByte)])
        )
        let pause: Promise<void> | undefined
        const onCreated = (item: chrome.downloads.DownloadItem) => {
          if (item.url === url) pause = chrome.downloads.pause(item.id)
        }
        chrome.downloads.onCreated.addListener(onCreated)
        try {
          const id = await chrome.downloads.download({
            url,
            filename: `${action}.bin`,
            saveAs: false,
          })
          if (!pause) throw new Error("Download creation was not observed")
          await pause
          const [item] = await chrome.downloads.search({ id })
          return { id, url, item }
        } finally {
          chrome.downloads.onCreated.removeListener(onCreated)
        }
      },
      { action, outputBytes, outputByte }
    )
    expect(accepted.item).toMatchObject({
      state: "in_progress",
      paused: true,
      bytesReceived: 0,
      totalBytes: outputBytes,
    })
    if (action === "complete") {
      await page.evaluate((id) => chrome.downloads.resume(id), accepted.id)
      await expect
        .poll(
          async () =>
            await page.evaluate(
              async (id) => (await chrome.downloads.search({ id }))[0]?.state,
              accepted.id
            )
        )
        .toBe("complete")
    }
    const stopped = await page.evaluate(
      async ({ action, id, url }) => {
        const events: string[] = []
        const onChanged = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id === id && delta.state?.current === "interrupted")
            events.push("interrupted")
        }
        const onErased = (erasedId: number) => {
          if (erasedId === id) events.push("erased")
        }
        chrome.downloads.onChanged.addListener(onChanged)
        chrome.downloads.onErased.addListener(onErased)
        try {
          let erasedIds: number[] | undefined
          if (action === "cancel") await chrome.downloads.cancel(id)
          if (action === "erase")
            erasedIds = await chrome.downloads.erase({ id })
          const items = await chrome.downloads.search({ id })
          URL.revokeObjectURL(url)
          let readable = true
          try {
            await fetch(url)
          } catch {
            readable = false
          }
          return { items, erasedIds, events, readable }
        } finally {
          chrome.downloads.onChanged.removeListener(onChanged)
          chrome.downloads.onErased.removeListener(onErased)
        }
      },
      { action, id: accepted.id, url: accepted.url }
    )
    expect(stopped.readable).toBe(false)
    if (action === "complete") {
      expect(await readFile(stopped.items[0]!.filename)).toEqual(
        Buffer.alloc(outputBytes, outputByte)
      )
    } else if (action === "cancel") {
      expect(stopped.items[0]).toMatchObject({
        state: "interrupted",
        error: "USER_CANCELED",
        canResume: false,
      })
      expect(stopped.events).toEqual(["interrupted"])
    } else {
      expect(stopped.erasedIds).toEqual([accepted.id])
      expect(stopped.items).toEqual([])
      expect(stopped.events).toEqual(["interrupted", "erased"])
    }
  }
})
