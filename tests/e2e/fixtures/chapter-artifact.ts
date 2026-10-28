import { unzipSync } from "fflate"
import type { Page } from "@playwright/test"

export function readChapterArchive(
  bytes: Uint8Array,
  expectedPageCount: number
): Array<{ name: string; bytes: Uint8Array }> {
  if (!Number.isSafeInteger(expectedPageCount) || expectedPageCount <= 0) {
    throw new Error("Expected a positive chapter page count")
  }
  const entries = Object.entries(unzipSync(bytes)).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true })
  )
  if (entries.length !== expectedPageCount) {
    throw new Error(
      `Expected ${expectedPageCount} chapter images, found ${entries.length}`
    )
  }
  return entries.map(([name, data], index) => {
    const page = String(index + 1).padStart(3, "0")
    if (!new RegExp(`^${page}\\.(jpg|png|webp|gif|avif)$`).test(name)) {
      throw new Error(`Expected numbered chapter image ${page}, found ${name}`)
    }
    if (data.byteLength === 0) {
      throw new Error(`Empty chapter image: ${name}`)
    }
    return { name, bytes: data }
  })
}

/** Decode saved bytes through Chromium, independently of extension processing. */
export async function inspectChapterArchive(
  page: Page,
  bytes: Uint8Array,
  expectedPageCount: number
): Promise<
  Array<{ name: string; width: number; height: number; preview?: string }>
> {
  const images = readChapterArchive(bytes, expectedPageCount)
  const inspected: Array<{
    name: string
    width: number
    height: number
    preview?: string
  }> = []
  for (const image of images) {
    const decoded = await page.evaluate(
      async ({ base64, preview }) => {
        const encoded = Uint8Array.from(atob(base64), (value) =>
          value.charCodeAt(0)
        )
        const bitmap = await createImageBitmap(new Blob([encoded]))
        try {
          if (!preview) return { width: bitmap.width, height: bitmap.height }
          const canvas = document.createElement("canvas")
          const scale = Math.min(1, 600 / bitmap.width, 900 / bitmap.height)
          canvas.width = Math.max(1, Math.round(bitmap.width * scale))
          canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const context = canvas.getContext("2d")
          if (!context) throw new Error("Image inspection canvas unavailable")
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          return {
            width: bitmap.width,
            height: bitmap.height,
            preview: canvas.toDataURL("image/png"),
          }
        } finally {
          bitmap.close()
        }
      },
      {
        base64: Buffer.from(image.bytes).toString("base64"),
        preview: inspected.length < 3,
      }
    )
    inspected.push({ name: image.name, ...decoded })
  }
  return inspected
}
