import { describe, expect, it } from "vitest"
import { SETTINGS_LIMITS } from "@/src/storage/settings-service"
import { settingsService } from "./settings-service-test-setup"

/**
 * Adversarial tests for settings limit clamping (SETTINGS_LIMITS).
 *
 * These cases exercise the normalizeSettings() clamping logic at
 * src/storage/settings-service.ts:268,275-276 against extreme and
 * boundary values that could originate from corrupted storage,
 * malformed extension messages, or buggy UI inputs.
 *
 * Constants under test:
 *   MAX_CONCURRENCY = 10
 *   MIN_CONCURRENCY = 1
 *   MAX_RETRIES     = 10
 *   MIN_RETRIES     = 0
 */
export function registerSettingsServiceAdversarialLimitsCases(): void {
  describe("Settings Limit Clamping (adversarial)", () => {
    describe("globalPolicy.image.concurrency", () => {
      it("clamps concurrency of 0 to MIN_CONCURRENCY (1)", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: 0 } },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(
          SETTINGS_LIMITS.MIN_CONCURRENCY
        )
      })

      it("clamps concurrency of 999 to MAX_CONCURRENCY (10)", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: 999 } },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(
          SETTINGS_LIMITS.MAX_CONCURRENCY
        )
      })

      it("clamps negative concurrency (-5) to MIN_CONCURRENCY (1)", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: -5 } },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(
          SETTINGS_LIMITS.MIN_CONCURRENCY
        )
      })

      it("clamps extremely large concurrency (Number.MAX_SAFE_INTEGER) to MAX_CONCURRENCY (10)", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: Number.MAX_SAFE_INTEGER } },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(
          SETTINGS_LIMITS.MAX_CONCURRENCY
        )
      })

      it("passes through concurrency at the MIN boundary (1) unchanged", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: 1 } },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(1)
      })

      it("passes through concurrency at the MAX boundary (10) unchanged", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: 10 } },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(10)
      })

      it("passes through a mid-range concurrency (5) unchanged", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: 5 } },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(5)
      })
    })

    describe("globalRetries.image", () => {
      it("clamps retries of -1 to MIN_RETRIES (0)", async () => {
        await settingsService.updateSettings({
          globalRetries: { image: -1 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MIN_RETRIES)
      })

      it("clamps retries of 999 to MAX_RETRIES (10)", async () => {
        await settingsService.updateSettings({
          globalRetries: { image: 999 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MAX_RETRIES)
      })

      it("clamps extremely negative retries (-9999) to MIN_RETRIES (0)", async () => {
        await settingsService.updateSettings({
          globalRetries: { image: -9999 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MIN_RETRIES)
      })

      it("clamps extremely large retries (Number.MAX_SAFE_INTEGER) to MAX_RETRIES (10)", async () => {
        await settingsService.updateSettings({
          globalRetries: { image: Number.MAX_SAFE_INTEGER },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MAX_RETRIES)
      })

      it("passes through retries at the MIN boundary (0) unchanged", async () => {
        await settingsService.updateSettings({
          globalRetries: { image: 0 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.image).toBe(0)
      })

      it("passes through retries at the MAX boundary (10) unchanged", async () => {
        await settingsService.updateSettings({
          globalRetries: { image: 10 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.image).toBe(10)
      })

      it("passes through a mid-range retries value (5) unchanged", async () => {
        await settingsService.updateSettings({
          globalRetries: { image: 5 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.image).toBe(5)
      })
    })

    describe("globalRetries.chapter", () => {
      it("clamps chapter retries of -1 to MIN_RETRIES (0)", async () => {
        await settingsService.updateSettings({
          globalRetries: { chapter: -1 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.chapter).toBe(SETTINGS_LIMITS.MIN_RETRIES)
      })

      it("clamps chapter retries of 999 to MAX_RETRIES (10)", async () => {
        await settingsService.updateSettings({
          globalRetries: { chapter: 999 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.chapter).toBe(SETTINGS_LIMITS.MAX_RETRIES)
      })

      it("passes through chapter retries at the MIN boundary (0) unchanged", async () => {
        await settingsService.updateSettings({
          globalRetries: { chapter: 0 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.chapter).toBe(0)
      })

      it("passes through chapter retries at the MAX boundary (10) unchanged", async () => {
        await settingsService.updateSettings({
          globalRetries: { chapter: 10 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalRetries.chapter).toBe(10)
      })
    })

    describe("combined concurrency and retries clamping", () => {
      it("clamps both concurrency and retries simultaneously when both are out of range", async () => {
        await settingsService.updateSettings({
          globalPolicy: { image: { concurrency: 0 } },
          globalRetries: { image: 999, chapter: -1 },
        })

        const settings = await settingsService.getSettings()
        expect(settings.globalPolicy.image.concurrency).toBe(
          SETTINGS_LIMITS.MIN_CONCURRENCY
        )
        expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MAX_RETRIES)
        expect(settings.globalRetries.chapter).toBe(SETTINGS_LIMITS.MIN_RETRIES)
      })

      it("clamps values loaded directly from corrupted persistent storage on reload", async () => {
        // Inject corrupted settings directly into storage, bypassing the update API,
        // then reload to verify normalizeSettings() clamps them.
        const { mockStorageData } =
          await import("./settings-service-test-setup")
        const { SETTINGS_STORAGE_KEY } =
          await import("@/src/storage/settings-service")
        const { DEFAULT_SETTINGS } =
          await import("@/src/storage/default-settings")

        mockStorageData[SETTINGS_STORAGE_KEY] = {
          ...DEFAULT_SETTINGS,
          globalPolicy: {
            image: { concurrency: 999, delayMs: 500 },
            chapter: { concurrency: 1, delayMs: 500 },
          },
          globalRetries: { image: -5, chapter: 9999 },
        }

        const settings = await settingsService.reload()
        expect(settings.globalPolicy.image.concurrency).toBe(
          SETTINGS_LIMITS.MAX_CONCURRENCY
        )
        expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MIN_RETRIES)
        expect(settings.globalRetries.chapter).toBe(SETTINGS_LIMITS.MAX_RETRIES)
      })
    })
  })
}
