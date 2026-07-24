import { describe, expect, it } from "vitest"
import {
  mockStorageData,
  siteIntegrationSettingsService,
  siteIntegrationSettingsStorageKey,
} from "./site-integration-settings-service-test-setup"

export function registerSiteIntegrationSettingsStorageCases(): void {
  describe("site-integration-settings-service", () => {
    it("serializes concurrent updates for different sites", async () => {
      await Promise.all([
        siteIntegrationSettingsService.updateForSite("site-a", {
          quality: "high",
        }),
        siteIntegrationSettingsService.updateForSite("site-b", {
          quality: "low",
        }),
      ])

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        "site-a": { quality: "high" },
        "site-b": { quality: "low" },
      })
    })

    it("returns canonical settings when siteIntegrationSettings exists", async () => {
      expect(siteIntegrationSettingsStorageKey).toBe("siteIntegrationSettings")

      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "data-saver",
        },
      }
      mockStorageData.siteDynamicSettings = {
        mangadex: {
          imageQuality: "data",
        },
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        mangadex: {
          imageQuality: "data-saver",
        },
      })
    })

    it("ignores legacy siteDynamicSettings when canonical settings are absent", async () => {
      mockStorageData.siteDynamicSettings = {
        mangadex: {
          autoReadMangaDexSettings: true,
        },
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
      expect(mockStorageData[siteIntegrationSettingsStorageKey]).toBeUndefined()
    })

    it("drops malformed per-site entries while preserving valid site settings", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "data",
          autoReadMangaDexSettings: false,
        },
        brokenString: "bad",
        brokenArray: ["bad"],
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        mangadex: {
          imageQuality: "data",
          autoReadMangaDexSettings: false,
        },
      })
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

    it("keeps unknown forward-compatible settings writable", async () => {
      await siteIntegrationSettingsService.setAll({
        futureIntegration: { futureSetting: ["value"] },
        mangadex: { futureSetting: { nested: true } },
      })

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        futureIntegration: { futureSetting: ["value"] },
        mangadex: { futureSetting: { nested: true } },
      })
    })
  })
}
