import { describe, expect, it } from "vitest"
import {
  mockStorageData,
  siteIntegrationSettingsService,
  siteIntegrationSettingsStorageKey,
} from "./site-integration-settings-service-test-setup"

export function registerSiteIntegrationSettingsAdversarialCases(): void {
  describe("site-integration-settings-service strict durable document", () => {
    it("treats an absent current key as an empty map", async () => {
      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it.each([null, undefined, "corrupted", 42, true, ["bad"]])(
      "rejects a present malformed top-level value %#",
      async (value) => {
        mockStorageData[siteIntegrationSettingsStorageKey] = value
        await expect(siteIntegrationSettingsService.getAll()).rejects.toThrow()
      }
    )

    it("rejects unknown setting IDs in an otherwise valid provider record", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "data",
          futureSetting: "retained",
        },
      }

      await expect(siteIntegrationSettingsService.getAll()).rejects.toThrow(
        /Unknown site integration setting/
      )
    })

    it("rejects invalid values instead of dropping them", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "unsupported-quality",
        },
      }

      await expect(siteIntegrationSettingsService.getAll()).rejects.toThrow(
        /Invalid value/
      )
    })

    it("getForSite propagates an invalid current document", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = "totally-corrupted"

      await expect(
        siteIntegrationSettingsService.getForSite("mangadex")
      ).rejects.toThrow()
    })

    it("does not rewrite an invalid current document while rejecting it", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = "corrupted"

      await expect(siteIntegrationSettingsService.getAll()).rejects.toThrow()
      expect(mockStorageData[siteIntegrationSettingsStorageKey]).toBe(
        "corrupted"
      )
    })

    it("accepts an explicit empty current document", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {}

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })
  })
}
