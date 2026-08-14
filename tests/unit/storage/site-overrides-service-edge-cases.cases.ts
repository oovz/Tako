import { describe, expect, it } from "vitest"
import { siteOverridesService } from "./site-overrides-service-test-setup"

export function registerSiteOverridesEdgeCases(): void {
  describe("Edge Cases", () => {
    it("should handle empty override object", async () => {
      await siteOverridesService.updateForSite("pixiv-comic", {})

      const overrides = await siteOverridesService.getAll()
      expect(overrides["pixiv-comic"]).toEqual({})
    })

    it("should handle override with only partial policy fields", async () => {
      await siteOverridesService.updateForSite("mangadex", {
        imagePolicy: { concurrency: 3 },
      })

      const overrides = await siteOverridesService.getAll()
      expect(overrides.mangadex.imagePolicy).toEqual({ concurrency: 3 })
      expect(overrides.mangadex.imagePolicy?.delayMs).toBeUndefined()
    })

    it("rejects a provider ID outside the generated catalog", async () => {
      const siteId = "site-with-dashes_and_underscores.dots"
      await expect(
        siteOverridesService.updateForSite(siteId, {
          outputFormat: "cbz",
        })
      ).rejects.toThrow(/Unknown site integration ID/)
    })

    it("should handle rapid sequential updates", async () => {
      await siteOverridesService.updateForSite("pixiv-comic", {
        outputFormat: "cbz",
      })
      await siteOverridesService.updateForSite("pixiv-comic", {
        pathTemplate: "/path",
      })
      await siteOverridesService.updateForSite("pixiv-comic", {
        imagePolicy: { concurrency: 5 },
      })

      const overrides = await siteOverridesService.getAll()
      expect(overrides["pixiv-comic"]).toEqual({
        outputFormat: "cbz",
        pathTemplate: "/path",
        imagePolicy: { concurrency: 5 },
      })
    })

    it("rejects out-of-range and fractional rate-policy overrides", async () => {
      await expect(
        siteOverridesService.updateForSite("mangadex", {
          imagePolicy: { concurrency: 11 },
        })
      ).rejects.toThrow()
      await expect(
        siteOverridesService.updateForSite("mangadex", {
          imagePolicy: { delayMs: 5001 },
        })
      ).rejects.toThrow()
      await expect(
        siteOverridesService.updateForSite("mangadex", {
          imagePolicy: { concurrency: 2.5 },
        })
      ).rejects.toThrow()

      await expect(siteOverridesService.getAll()).resolves.toEqual({})
    })

    it("rejects retry overrides outside the current settings limits", async () => {
      await expect(
        siteOverridesService.updateForSite("mangadex", {
          retries: { image: 11 },
        })
      ).rejects.toThrow()
      await expect(
        siteOverridesService.updateForSite("mangadex", {
          retries: { chapter: 1.5 },
        })
      ).rejects.toThrow()

      await expect(siteOverridesService.getAll()).resolves.toEqual({})
    })
  })
}
