import { describe, expect, it } from "vitest"
import {
  buildPublusPageTileRects,
  type PublusTileRect,
} from "@/src/site-integrations/comictropics/publus-image"

function coveredPixels(
  rects: PublusTileRect[],
  width: number,
  height: number,
  axis: "src" | "dest"
): Set<number> {
  const pixels = new Set<number>()
  for (const rect of rects) {
    const left = axis === "src" ? rect.srcX : rect.destX
    const top = axis === "src" ? rect.srcY : rect.destY
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + rect.width).toBeLessThanOrEqual(width)
    expect(top + rect.height).toBeLessThanOrEqual(height)
    for (let y = top; y < top + rect.height; y += 1) {
      for (let x = left; x < left + rect.width; x += 1) {
        const pixel = y * width + x
        expect(pixels.has(pixel)).toBe(false)
        pixels.add(pixel)
      }
    }
  }
  return pixels
}

describe("PUBLUS tile coverage", () => {
  it.each([
    [4, 4],
    [5, 4],
    [4, 5],
    [5, 5],
    [2, 7],
    [7, 2],
    [17, 11],
  ])(
    "partitions both raster surfaces once for a %dx%d image",
    (width, height) => {
      const rects = buildPublusPageTileRects({
        sourceWidth: width,
        sourceHeight: height,
        tileWidth: 2,
        tileHeight: 2,
        mode: 372,
        seed1: 2734906895,
        seed2: 3927281451,
        seed3: 1733819256,
      })
      expect(coveredPixels(rects, width, height, "src").size).toBe(
        width * height
      )
      expect(coveredPixels(rects, width, height, "dest").size).toBe(
        width * height
      )
    }
  )
})
