import { readFile } from "node:fs/promises"

import { test, expect } from "./fixtures/extension"

const outputBytes = 4096
const outputByte = 73

test("retains Blob output through acceptance and releases it after Chrome consumption stops", async ({
  context,
  extensionId,
  page,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const browser = await context.newCDPSession(page)
  await browser.send("Browser.setDownloadBehavior", {
    behavior: "default",
    eventsEnabled: true,
  })

  const results = await page.evaluate(
    async ({ outputBytes, outputByte }) => {
      const results = []
      for (const action of ["complete", "cancel", "erase"] as const) {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(outputBytes).fill(outputByte)])
        )
        const held = Promise.withResolvers<number>()
        let suggest:
          | ((suggestion?: chrome.downloads.FilenameSuggestion) => void)
          | undefined
        const events: string[] = []
        let downloadId: number | undefined
        const completed = Promise.withResolvers<void>()
        const onFilename = (
          item: chrome.downloads.DownloadItem,
          callback: (suggestion?: chrome.downloads.FilenameSuggestion) => void
        ) => {
          if (item.url !== url) {
            callback()
            return
          }
          suggest = callback
          held.resolve(item.id)
          return true
        }
        const onChanged = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return
          const state = delta.state?.current
          if (state === "complete" || state === "interrupted")
            events.push(state)
          if (state === "complete") completed.resolve()
        }
        const onErased = (id: number) => {
          if (id === downloadId) events.push("erased")
        }
        chrome.downloads.onDeterminingFilename.addListener(onFilename)
        chrome.downloads.onChanged.addListener(onChanged)
        chrome.downloads.onErased.addListener(onErased)
        try {
          const [id, heldId] = await Promise.all([
            chrome.downloads.download({
              url,
              filename: `${action}.bin`,
              saveAs: false,
            }),
            held.promise,
          ])
          downloadId = id
          const [accepted] = await chrome.downloads.search({ id })
          const readableBytes = (await (await fetch(url)).arrayBuffer())
            .byteLength
          let erasedIds: number[] | undefined
          if (action === "complete") {
            suggest!()
            await completed.promise
          }
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
          results.push({
            action,
            id,
            heldId,
            accepted,
            readableBytes,
            items,
            erasedIds,
            events,
            readable,
          })
        } finally {
          chrome.downloads.onDeterminingFilename.removeListener(onFilename)
          chrome.downloads.onChanged.removeListener(onChanged)
          chrome.downloads.onErased.removeListener(onErased)
          URL.revokeObjectURL(url)
        }
      }
      return results
    },
    { outputBytes, outputByte }
  )

  for (const result of results) {
    expect(result.id).toBe(result.heldId)
    expect(result.accepted.state).toBe("in_progress")
    expect(result.readableBytes).toBe(outputBytes)
    expect(result.readable).toBe(false)
    if (result.action === "complete") {
      expect(result.items[0]?.state).toBe("complete")
      expect(await readFile(result.items[0]!.filename)).toEqual(
        Buffer.alloc(outputBytes, outputByte)
      )
    } else if (result.action === "cancel") {
      expect(result.items[0]).toMatchObject({
        state: "interrupted",
        error: "USER_CANCELED",
        canResume: false,
      })
      expect(result.events).toEqual(["interrupted"])
    } else {
      expect(result.erasedIds).toEqual([result.id])
      expect(result.items).toEqual([])
      expect(result.events).toEqual(["interrupted", "erased"])
    }
  }
})
