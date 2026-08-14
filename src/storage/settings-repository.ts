import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import { createDefaultSettings } from "@/src/domain/settings/defaults"
import {
  cloneSettings,
  parseSettingsDocument,
} from "@/src/domain/settings/schema"
import type {
  ExtensionSettings,
  RetryCounts,
} from "@/src/domain/settings/types"

export const SETTINGS_STORAGE_KEY = "settings:global"

export class SettingsRepository {
  private cache: ExtensionSettings | null = null
  private loadPromise: Promise<ExtensionSettings> | null = null
  private cacheGeneration = 0
  private readonly mutations = new StorageMutationQueue()
  private readonly defaultLogLevel: "debug" | "warn"

  constructor(defaultLogLevel: "debug" | "warn") {
    this.defaultLogLevel = defaultLogLevel
  }
  async getSettings(): Promise<ExtensionSettings> {
    if (this.cache) return cloneSettings(this.cache)
    if (!this.loadPromise) {
      const loadPromise = this.mutations.run(() => this.readDocument())
      this.loadPromise = loadPromise
      void loadPromise.then(
        () => {
          if (this.loadPromise === loadPromise) this.loadPromise = null
        },
        () => {
          if (this.loadPromise === loadPromise) this.loadPromise = null
        }
      )
    }
    return cloneSettings(await this.loadPromise)
  }
  async reload(): Promise<ExtensionSettings> {
    this.invalidateCache()
    return this.getSettings()
  }
  async replaceSettings(
    settings: ExtensionSettings
  ): Promise<ExtensionSettings> {
    return this.mutations.run(async () => {
      const next = cloneSettings(parseSettingsDocument(settings))
      await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next })
      this.cache = cloneSettings(next)
      return cloneSettings(next)
    })
  }
  async getGlobalPolicy(): Promise<{
    image: RateScopePolicy
    chapter: RateScopePolicy
  }> {
    return structuredClone((await this.getSettings()).globalPolicy)
  }
  async getGlobalRetries(): Promise<RetryCounts> {
    return structuredClone((await this.getSettings()).globalRetries)
  }
  acceptExternalDocument(value: unknown): void {
    const settings = parseSettingsDocument(value)
    this.cacheGeneration += 1
    this.cache = cloneSettings(settings)
  }
  getCachedSettings(): ExtensionSettings | null {
    return this.cache ? cloneSettings(this.cache) : null
  }
  invalidateCache(): void {
    this.cacheGeneration += 1
    this.cache = null
    this.loadPromise = null
  }
  private async readDocument(): Promise<ExtensionSettings> {
    while (true) {
      const generation = this.cacheGeneration
      const result = await chrome.storage.local.get([SETTINGS_STORAGE_KEY])
      if (generation !== this.cacheGeneration) {
        if (this.cache) return cloneSettings(this.cache)
        continue
      }

      if (!(SETTINGS_STORAGE_KEY in result)) {
        const defaults = createDefaultSettings(this.defaultLogLevel)
        await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: defaults })
        if (generation !== this.cacheGeneration) {
          if (this.cache) return cloneSettings(this.cache)
          continue
        }
        this.cache = cloneSettings(defaults)
        return cloneSettings(defaults)
      }

      const settings = parseSettingsDocument(result[SETTINGS_STORAGE_KEY])
      if (generation !== this.cacheGeneration) {
        if (this.cache) return cloneSettings(this.cache)
        continue
      }
      this.cache = cloneSettings(settings)
      return cloneSettings(settings)
    }
  }
}
