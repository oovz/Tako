import { describe, expect, it } from "vitest"
import {
  canonicalStorageKey,
  mockStorageData,
  siteIntegrationEnablementService,
} from "./site-integration-enablement-service-test-setup"

export function registerSiteIntegrationEnablementServiceCases(): void {
  describe("site-integration-enablement-service", () => {
    it("serializes concurrent enablement updates", async () => {
      await Promise.all([
        siteIntegrationEnablementService.setEnabled("mangadex", true),
        siteIntegrationEnablementService.setEnabled("pixiv-comic", false),
      ])

      await expect(siteIntegrationEnablementService.getAll()).resolves.toEqual({
        mangadex: true,
        "pixiv-comic": false,
      })
    })

    it("stores enablement in the canonical storage key", async () => {
      await siteIntegrationEnablementService.setAll({ mangadex: false })

      expect(mockStorageData[canonicalStorageKey]).toEqual({ mangadex: false })
    })

    it("rejects unknown provider IDs on write without touching storage", async () => {
      await expect(
        siteIntegrationEnablementService.setAll({ "unknown-provider": true })
      ).rejects.toThrow(/Unknown site integration ID/)
      await expect(
        siteIntegrationEnablementService.setEnabled("unknown-provider", true)
      ).rejects.toThrow(/Unknown site integration ID/)
      expect(mockStorageData[canonicalStorageKey]).toBeUndefined()
    })

    it("rejects unknown provider IDs in a present stored document", async () => {
      mockStorageData[canonicalStorageKey] = { "unknown-provider": true }
      await expect(siteIntegrationEnablementService.getAll()).rejects.toThrow(
        /Unknown site integration ID/
      )
    })
  })
}
