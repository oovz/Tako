import { optionsValuesEqual as valuesEqual } from "../state/options-configuration-reducer-values"
import type { OptionsConfigurationData } from "@/src/runtime/runtime-message-contracts"
import {
  OPTIONS_CONFIGURATION_STORAGE_KEYS,
  type OptionsConfigurationSnapshot,
  type OptionsConfigurationStorageKey,
} from "../state/options-configuration-reducer"
import type { OptionsConfigurationLoader } from "./options-configuration-client"

interface OptionsExternalChangeDependencies {
  isSaving: () => boolean
  isDirty: () => boolean
  hasUnsavedChanges: () => boolean
  draftRevision: () => number
  onConflict: (keys: OptionsConfigurationStorageKey[]) => void
  onSync: (latest: OptionsConfigurationData) => void
  onError: (error: unknown, keys: OptionsConfigurationStorageKey[]) => void
}

export interface OptionsSaveExpectation {
  expectStorageChange?: boolean
}

interface PendingSaveExpectation {
  expected: OptionsConfigurationSnapshot
  expectStorageChange: boolean
}

/** Owns storage-change generations so stale reads cannot overwrite a draft. */
export class OptionsExternalChangeController {
  private requestGeneration = 0
  private changeRevision = 0
  private nextSaveToken = 0
  private readonly pendingSaves = new Map<number, PendingSaveExpectation>()

  constructor(private readonly configuration: OptionsConfigurationLoader) {}

  get revision(): number {
    return this.changeRevision
  }

  /** Mark the exact configuration submitted by one Options save. */
  beginSave(
    expected: OptionsConfigurationSnapshot,
    options: OptionsSaveExpectation = {}
  ): number {
    const token = ++this.nextSaveToken
    this.pendingSaves.set(token, {
      expected: structuredClone(expected),
      expectStorageChange: options.expectStorageChange ?? true,
    })
    return token
  }

  /**
   * Retain successful writes that should produce an onChanged event so a
   * delayed event can be matched. No-op writes are retired at the successful
   * response because Chrome emits no storage event for unchanged values.
   * Failed saves remove only their own marker.
   */
  completeSave(token: number, success: boolean): void {
    const marker = this.pendingSaves.get(token)
    if (!marker) return
    if (!success || !marker.expectStorageChange) {
      this.pendingSaves.delete(token)
    }
  }

  /**
   * Load the initial projection under the same generation fence as storage
   * events. A newer event invalidates the result so an older response cannot
   * hydrate over the authoritative projection (or a local draft).
   */
  async loadInitial(
    isCurrent: () => boolean = () => true
  ): Promise<OptionsConfigurationData | null> {
    const requestId = ++this.requestGeneration
    try {
      const loaded = await this.configuration.load()
      if (requestId !== this.requestGeneration || !isCurrent()) return null
      return loaded
    } catch (error) {
      if (requestId !== this.requestGeneration || !isCurrent()) return null
      throw error
    }
  }

  invalidatePendingReads(): void {
    this.requestGeneration += 1
  }

  private isOwnSaveChange(
    changes: Record<string, chrome.storage.StorageChange>
  ): number | null {
    const changedKeys = OPTIONS_CONFIGURATION_STORAGE_KEYS.filter(
      (key) => changes[key] !== undefined
    )
    if (changedKeys.length === 0) return null

    for (const [token, marker] of this.pendingSaves) {
      const expectedValues: Record<OptionsConfigurationStorageKey, unknown> = {
        "settings:global": marker.expected.settings,
        siteOverrides: marker.expected.overrides,
        siteIntegrationEnablement: marker.expected.enablement,
        siteIntegrationSettings: marker.expected.integrationSettings,
      }
      if (
        changedKeys.every((key) =>
          valuesEqual(changes[key]?.newValue, expectedValues[key])
        )
      ) {
        return token
      }
    }
    return null
  }

  private async readExternalChange(
    dependencies: OptionsExternalChangeDependencies,
    changedKeys: OptionsConfigurationStorageKey[],
    isCurrent: () => boolean
  ): Promise<void> {
    const draftRevisionAtStart = dependencies.draftRevision()
    try {
      const latest = await this.configuration.load()
      if (!isCurrent()) return
      if (
        dependencies.isSaving() ||
        dependencies.isDirty() ||
        dependencies.draftRevision() !== draftRevisionAtStart
      ) {
        dependencies.onConflict(changedKeys)
        return
      }
      dependencies.onSync(latest)
    } catch (error) {
      if (isCurrent()) dependencies.onError(error, changedKeys)
    }
  }

  private handleStorageChange(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
    dependencies: OptionsExternalChangeDependencies,
    isSubscribed: () => boolean
  ): void {
    if (areaName !== "local") return
    const changedKeys = OPTIONS_CONFIGURATION_STORAGE_KEYS.filter(
      (key) => changes[key] !== undefined
    )
    if (changedKeys.length === 0) return

    // Match the exact submitted values even when Chrome emits before the response.
    const ownSaveToken = this.isOwnSaveChange(changes)
    if (ownSaveToken !== null) {
      this.pendingSaves.delete(ownSaveToken)
      return
    }
    this.changeRevision += 1
    const requestId = ++this.requestGeneration
    if (
      dependencies.isSaving() ||
      dependencies.isDirty() ||
      dependencies.hasUnsavedChanges()
    ) {
      dependencies.onConflict(changedKeys)
      return
    }
    void this.readExternalChange(
      dependencies,
      changedKeys,
      () => isSubscribed() && requestId === this.requestGeneration
    )
  }

  subscribe(dependencies: OptionsExternalChangeDependencies): () => void {
    let canceled = false
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => {
      this.handleStorageChange(changes, areaName, dependencies, () => !canceled)
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      canceled = true
      this.invalidatePendingReads()
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }
}
