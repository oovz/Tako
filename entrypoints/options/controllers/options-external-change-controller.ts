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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => valuesEqual(entry, right[index]))
    )
  }
  if (!isRecord(left) || !isRecord(right)) return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key])
    )
  )
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

  subscribe(dependencies: OptionsExternalChangeDependencies): () => void {
    let canceled = false

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => {
      if (areaName !== "local") return
      const changedKeys = OPTIONS_CONFIGURATION_STORAGE_KEYS.filter(
        (key) => changes[key] !== undefined
      )
      if (changedKeys.length === 0) return

      // Chrome may deliver the write event before SAVE_OPTIONS_CONFIGURATION
      // resolves. Suppress only values matching the exact submitted snapshot;
      // any differing key is a real concurrent writer and remains a conflict.
      const ownSaveToken = this.isOwnSaveChange(changes)
      if (ownSaveToken !== null) {
        this.pendingSaves.delete(ownSaveToken)
        return
      }

      this.changeRevision += 1
      const requestId = ++this.requestGeneration
      const recordConflict = () => dependencies.onConflict(changedKeys)
      // Do not drop storage events while a save is in flight. We cannot tell
      // whether the event came from this save or another writer, so retain the
      // conflict and fence any read that started before it.
      if (dependencies.isSaving()) {
        recordConflict()
        return
      }
      if (dependencies.isDirty() || dependencies.hasUnsavedChanges()) {
        recordConflict()
        return
      }

      const draftRevisionAtStart = dependencies.draftRevision()
      void this.configuration
        .load()
        .then((latest) => {
          if (canceled || requestId !== this.requestGeneration) return
          if (
            dependencies.isSaving() ||
            dependencies.isDirty() ||
            dependencies.draftRevision() !== draftRevisionAtStart
          ) {
            recordConflict()
            return
          }
          dependencies.onSync(latest)
        })
        .catch((error: unknown) => {
          if (!canceled && requestId === this.requestGeneration) {
            dependencies.onError(error, changedKeys)
          }
        })
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      canceled = true
      this.invalidatePendingReads()
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }
}
