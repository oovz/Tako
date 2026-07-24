import { describe, expect, it } from "vitest"
import {
  mockStorageData,
  siteIntegrationSettingsService,
  siteIntegrationSettingsStorageKey,
} from "./site-integration-settings-service-test-setup"

/**
 * Adversarial tests for site-integration-settings-service safeParse validation.
 *
 * Source: src/storage/site-integration-settings-service.ts:30,40
 *
 * The service uses Zod safeParse() to validate settings maps loaded from
 * chrome.storage.local. Malformed, corrupted, or hostile data in storage
 * must be rejected gracefully (not crash) and fall back to a safe default.
 */
export function registerSiteIntegrationSettingsAdversarialCases(): void {
  describe("site-integration-settings-service safeParse (adversarial)", () => {
    it("returns an empty map when storage is empty (safe default)", async () => {
      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("returns an empty map when the storage value is null", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = null

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("returns an empty map when the storage value is undefined", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = undefined

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("returns an empty map when the storage value is a string (not an object)", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] =
        "corrupted-json-string"

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("returns an empty map when the storage value is a number (not an object)", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = 42

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("returns an empty map when the storage value is a boolean (not an object)", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = true

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("returns an empty map when the storage value is an array (not a record)", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = ["bad", "data"]

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("does not crash when storage contains deeply nested malformed JSON-like structures", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          nested: {
            deeply: {
              invalid: { structure: Symbol("sym") as unknown as string },
            },
          },
        },
      }

      // Should not throw; invalid entries are silently dropped via safeParse.
      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("drops per-site entries with non-record values (string, number, array, null)", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        validSite: { setting: "value" },
        stringSite: "bad",
        numberSite: 123,
        arraySite: ["bad"],
        nullSite: null,
        booleanSite: true,
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        validSite: { setting: "value" },
      })
    })

    it("handles settings with extra/unknown fields by preserving them (record schema is permissive)", async () => {
      // The SiteIntegrationSettingsRecordSchema is z.record(z.string(), StorageValueSchema),
      // which accepts arbitrary string keys. Unknown fields are retained, not rejected.
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "data",
          unknownSetting: "extra-value",
          anotherUnknown: 42,
        },
      }

      const result = await siteIntegrationSettingsService.getAll()
      expect(result.mangadex).toEqual({
        imageQuality: "data",
        unknownSetting: "extra-value",
        anotherUnknown: 42,
      })
    })

    it("drops invalid known option values while preserving unknown fields", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "unsupported-quality",
          chapterLanguageFilter: ["en", "unsupported-language"],
          autoReadMangaDexSettings: "yes",
          futureSetting: "retained",
        },
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        mangadex: {
          futureSetting: "retained",
        },
      })
      await expect(
        siteIntegrationSettingsService.getForSite("mangadex")
      ).resolves.toMatchObject({
        imageQuality: "data-saver",
        chapterLanguageFilter: [],
        autoReadMangaDexSettings: true,
        futureSetting: "retained",
      })
    })

    it("drops individual setting values that do not match StorageValueSchema (e.g. functions)", async () => {
      // Functions are not valid StorageValue (string | number | boolean | null | array | record).
      // safeParse should reject the entire per-site record if it contains a function value.
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: "data",
          badFunction: (() => "oops") as unknown as string,
        },
        validSite: { setting: "ok" },
      }

      const result = await siteIntegrationSettingsService.getAll()
      // mangadex is dropped because it contains an invalid value; validSite survives.
      expect(result.mangadex).toBeUndefined()
      expect(result.validSite).toEqual({ setting: "ok" })
    })

    it("handles deeply nested record structures without crashing", async () => {
      // Deeply nested (but non-circular) records are valid StorageValue values.
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          nested: { deeply: { valid: { structure: "value" } } },
        },
      }

      const result = await siteIntegrationSettingsService.getAll()
      expect(result.mangadex).toEqual({
        nested: { deeply: { valid: { structure: "value" } } },
      })
    })

    it("getForSite returns manifest defaults when storage is corrupted", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = "totally-corrupted"

      // getForSite should still return manifest defaults for a known site.
      await expect(
        siteIntegrationSettingsService.getForSite("mangadex")
      ).resolves.toMatchObject({
        imageQuality: "data-saver",
        autoReadMangaDexSettings: true,
      })
    })

    it("getForSite returns manifest defaults when storage value is null", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = null

      await expect(
        siteIntegrationSettingsService.getForSite("mangadex")
      ).resolves.toMatchObject({
        imageQuality: "data-saver",
      })
    })

    it("does not persist corrupted data back to storage when reading", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = "corrupted"

      await siteIntegrationSettingsService.getAll()

      // The corrupted value should remain unchanged (read does not write).
      expect(mockStorageData[siteIntegrationSettingsStorageKey]).toBe(
        "corrupted"
      )
    })

    it("handles an empty object in storage gracefully", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {}

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })

    it("handles a storage value with only invalid site entries (all dropped)", async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        bad1: "string",
        bad2: 123,
        bad3: true,
        bad4: null,
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
    })
  })
}
