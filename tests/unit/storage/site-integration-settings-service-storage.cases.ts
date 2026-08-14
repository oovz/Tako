import { describe, expect, it } from "vitest"
import {
  mockStorageData,
  siteIntegrationSettingsService,
  siteIntegrationSettingsStorageKey,
} from "./site-integration-settings-service-test-setup"

export function registerSiteIntegrationSettingsStorageCases(): void {
  describe("site-integration-settings-service", () => {
    it("serializes concurrent updates without losing fields", async () => {
      await Promise.all([
        siteIntegrationSettingsService.updateForSite("mangadex", {
          imageQuality: "data",
        }),
        siteIntegrationSettingsService.updateForSite("mangadex", {
          autoReadMangaDexSettings: false,
        }),
      ])

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        mangadex: {
          imageQuality: "data",
          autoReadMangaDexSettings: false,
        },
      })
    })

    it("returns canonical settings when siteIntegrationSettings exists", async () => {
      expect(siteIntegrationSettingsStorageKey).toBe("siteIntegrationSettings")

      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "data-saver",
        },
      }
      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        mangadex: {
          imageQuality: "data-saver",
        },
      })
    })

    it("rejects the complete current document when any site entry is malformed", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "data",
          autoReadMangaDexSettings: false,
        },
        brokenString: "bad",
        brokenArray: ["bad"],
      }

      await expect(siteIntegrationSettingsService.getAll()).rejects.toThrow()
    })

    it("rejects invalid known select and multiselect values on write", async () => {
      await expect(
        siteIntegrationSettingsService.setAll({
          mangadex: { imageQuality: "unsupported-quality" },
        })
      ).rejects.toThrow(/Invalid value/)

      await expect(
        siteIntegrationSettingsService.updateForSite("mangadex", {
          chapterLanguageFilter: ["en", "unsupported-language"],
        })
      ).rejects.toThrow(/Invalid value/)

      expect(mockStorageData[siteIntegrationSettingsStorageKey]).toBeUndefined()
    })

    it("rejects an unknown provider ID before updating settings", async () => {
      await expect(
        siteIntegrationSettingsService.updateForSite("unknown-provider", {
          value: true,
        })
      ).rejects.toThrow(/Unknown site integration ID/)
      expect(mockStorageData[siteIntegrationSettingsStorageKey]).toBeUndefined()
    })

    it("rejects unknown providers and settings on write", async () => {
      await expect(
        siteIntegrationSettingsService.setAll({
          futureIntegration: { futureSetting: ["value"] },
        })
      ).rejects.toThrow(/Unknown site integration ID/)
      await expect(
        siteIntegrationSettingsService.setAll({
          mangadex: { futureSetting: { nested: true } },
        })
      ).rejects.toThrow(/Unknown site integration setting/)
      expect(mockStorageData[siteIntegrationSettingsStorageKey]).toBeUndefined()
    })
  })
}
