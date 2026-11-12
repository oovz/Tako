import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { isRecord } from "@/src/shared/type-guards"

export interface ExtensionUpdateActionItem {
  status: "available"
  version?: string
  detectedAt: number
}

export type FsaDestinationIssue = "permission_required" | "unavailable"

export interface FsaDestinationActionItem {
  issue: FsaDestinationIssue
  detectedAt: number
}

export interface HostPermissionActionItem {
  integrationIds: string[]
  detectedAt: number
}

export interface OptionsActionItems {
  extensionUpdate?: ExtensionUpdateActionItem
  fsaDestination?: FsaDestinationActionItem
  hostPermission?: HostPermissionActionItem
}

export type OptionsActionItemSeverity = "warning" | "error"

export const OPTIONS_ACTION_ITEM_KEYS = [
  SESSION_STORAGE_KEYS.optionsActionItems,
  SESSION_STORAGE_KEYS.fsaDestinationActionItem,
  SESSION_STORAGE_KEYS.hostPermissionActionItem,
]

interface CreateExtensionUpdateActionItemInput {
  version?: string
  detectedAt: number
}

interface PersistOptionsActionItemsInput {
  storageArea?: Pick<chrome.storage.StorageArea, "get" | "set">
  now?: () => number
}

interface ExtensionUpdatePersistenceInput extends PersistOptionsActionItemsInput {
  version?: string
}

interface FsaDestinationPersistenceInput extends PersistOptionsActionItemsInput {
  issue: FsaDestinationIssue
}

interface HostPermissionPersistenceInput extends PersistOptionsActionItemsInput {
  integrationIds: string[]
}

function getSessionStorageArea():
  Pick<chrome.storage.StorageArea, "get" | "set"> | undefined {
  return (
    globalThis as {
      chrome?: { storage?: { session?: chrome.storage.StorageArea } }
    }
  ).chrome?.storage?.session
}

export function createExtensionUpdateActionItem({
  version,
  detectedAt,
}: CreateExtensionUpdateActionItemInput): OptionsActionItems {
  return {
    extensionUpdate: {
      status: "available",
      ...(version ? { version } : {}),
      detectedAt,
    },
  }
}

function parseExtensionUpdateActionItem(
  raw: unknown
): ExtensionUpdateActionItem | undefined {
  if (
    !isRecord(raw) ||
    raw.status !== "available" ||
    typeof raw.detectedAt !== "number"
  ) {
    return undefined
  }
  return {
    status: "available",
    ...(typeof raw.version === "string" && raw.version
      ? { version: raw.version }
      : {}),
    detectedAt: raw.detectedAt,
  }
}

function parseFsaDestinationActionItem(
  raw: unknown
): FsaDestinationActionItem | undefined {
  if (
    !isRecord(raw) ||
    (raw.issue !== "permission_required" && raw.issue !== "unavailable") ||
    typeof raw.detectedAt !== "number"
  ) {
    return undefined
  }
  return { issue: raw.issue, detectedAt: raw.detectedAt }
}

function parseHostPermissionActionItem(
  raw: unknown
): HostPermissionActionItem | undefined {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.integrationIds) ||
    !raw.integrationIds.every((id) => typeof id === "string") ||
    typeof raw.detectedAt !== "number"
  ) {
    return undefined
  }
  return {
    integrationIds: raw.integrationIds,
    detectedAt: raw.detectedAt,
  }
}

export function parseOptionsActionItems(raw: unknown): OptionsActionItems {
  if (!isRecord(raw)) {
    return {}
  }

  const items: OptionsActionItems = {}
  const extensionUpdate = parseExtensionUpdateActionItem(raw.extensionUpdate)
  if (extensionUpdate) items.extensionUpdate = extensionUpdate
  const fsaDestination = parseFsaDestinationActionItem(raw.fsaDestination)
  if (fsaDestination) items.fsaDestination = fsaDestination
  const hostPermission = parseHostPermissionActionItem(raw.hostPermission)
  if (hostPermission) items.hostPermission = hostPermission
  return items
}

export function parseStoredOptionsActionItems(
  raw: unknown
): OptionsActionItems {
  if (!isRecord(raw)) return {}

  const update = raw[SESSION_STORAGE_KEYS.optionsActionItems]
  return parseOptionsActionItems({
    extensionUpdate: isRecord(update) ? update.extensionUpdate : undefined,
    fsaDestination: raw[SESSION_STORAGE_KEYS.fsaDestinationActionItem],
    hostPermission: raw[SESSION_STORAGE_KEYS.hostPermissionActionItem],
  })
}

export function getOptionsActionItemSeverity(
  items: OptionsActionItems
): OptionsActionItemSeverity | null {
  if (items.fsaDestination?.issue === "unavailable") return "error"
  if (
    items.fsaDestination ||
    items.extensionUpdate ||
    items.hostPermission?.integrationIds.length
  ) {
    return "warning"
  }
  return null
}

export async function readHostPermissionActionItem(): Promise<
  HostPermissionActionItem | undefined
> {
  const storageArea = getSessionStorageArea()
  if (!storageArea) return undefined
  const key = SESSION_STORAGE_KEYS.hostPermissionActionItem
  const result = await storageArea.get(key)
  return parseHostPermissionActionItem(result[key])
}

// Keep each source in its own key. Options and the worker can update these
// independently, without a cross-context read/modify/write of the same value.
async function writeActionItem(
  key: (typeof OPTIONS_ACTION_ITEM_KEYS)[number],
  value: unknown,
  storageArea: Pick<chrome.storage.StorageArea, "set"> | undefined
): Promise<void> {
  await storageArea?.set({ [key]: value })
}

export async function markExtensionUpdateActionItemAvailable({
  version,
  storageArea = getSessionStorageArea(),
  now = Date.now,
}: ExtensionUpdatePersistenceInput = {}): Promise<void> {
  await writeActionItem(
    SESSION_STORAGE_KEYS.optionsActionItems,
    createExtensionUpdateActionItem({ version, detectedAt: now() }),
    storageArea
  )
}

export async function clearExtensionUpdateActionItem({
  storageArea = getSessionStorageArea(),
}: PersistOptionsActionItemsInput = {}): Promise<void> {
  await writeActionItem(
    SESSION_STORAGE_KEYS.optionsActionItems,
    {},
    storageArea
  )
}

export async function markFsaDestinationActionItem({
  issue,
  storageArea = getSessionStorageArea(),
  now = Date.now,
}: FsaDestinationPersistenceInput): Promise<void> {
  await writeActionItem(
    SESSION_STORAGE_KEYS.fsaDestinationActionItem,
    { issue, detectedAt: now() },
    storageArea
  )
}

export async function clearFsaDestinationActionItem({
  storageArea = getSessionStorageArea(),
}: PersistOptionsActionItemsInput = {}): Promise<void> {
  await writeActionItem(
    SESSION_STORAGE_KEYS.fsaDestinationActionItem,
    null,
    storageArea
  )
}

export async function markHostPermissionActionItem({
  integrationIds,
  storageArea = getSessionStorageArea(),
  now = Date.now,
}: HostPermissionPersistenceInput): Promise<void> {
  if (integrationIds.length === 0) return
  await writeActionItem(
    SESSION_STORAGE_KEYS.hostPermissionActionItem,
    { integrationIds: [...new Set(integrationIds)].sort(), detectedAt: now() },
    storageArea
  )
}

export async function clearHostPermissionActionItem({
  storageArea = getSessionStorageArea(),
}: PersistOptionsActionItemsInput = {}): Promise<void> {
  await writeActionItem(
    SESSION_STORAGE_KEYS.hostPermissionActionItem,
    null,
    storageArea
  )
}
