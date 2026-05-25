import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { isRecord } from '@/src/shared/type-guards'

export interface ExtensionUpdateActionItem {
  status: 'available'
  version?: string
  detectedAt: number
}

export interface OptionsActionItems {
  extensionUpdate?: ExtensionUpdateActionItem
}

interface CreateExtensionUpdateActionItemInput {
  version?: string
  detectedAt: number
}

interface PersistOptionsActionItemsInput {
  storageArea?: Pick<chrome.storage.StorageArea, 'get' | 'set'>
  now?: () => number
}

interface ExtensionUpdatePersistenceInput extends PersistOptionsActionItemsInput {
  version?: string
}

function getSessionStorageArea(): Pick<chrome.storage.StorageArea, 'get' | 'set'> | undefined {
  return (globalThis as { chrome?: { storage?: { session?: chrome.storage.StorageArea } } }).chrome?.storage?.session
}

export function createExtensionUpdateActionItem({
  version,
  detectedAt,
}: CreateExtensionUpdateActionItemInput): OptionsActionItems {
  return {
    extensionUpdate: {
      status: 'available',
      ...(version ? { version } : {}),
      detectedAt,
    },
  }
}

export function parseOptionsActionItems(raw: unknown): OptionsActionItems {
  if (!isRecord(raw)) {
    return {}
  }

  const rawUpdate = raw.extensionUpdate
  if (!isRecord(rawUpdate) || rawUpdate.status !== 'available' || typeof rawUpdate.detectedAt !== 'number') {
    return {}
  }

  return {
    extensionUpdate: {
      status: 'available',
      ...(typeof rawUpdate.version === 'string' && rawUpdate.version ? { version: rawUpdate.version } : {}),
      detectedAt: rawUpdate.detectedAt,
    },
  }
}

export function hasOptionsActionItems(items: OptionsActionItems): boolean {
  return items.extensionUpdate?.status === 'available'
}

async function readOptionsActionItems(storageArea: Pick<chrome.storage.StorageArea, 'get'>): Promise<OptionsActionItems> {
  const result = await storageArea.get(SESSION_STORAGE_KEYS.optionsActionItems) as Record<string, unknown>
  return parseOptionsActionItems(result[SESSION_STORAGE_KEYS.optionsActionItems])
}

export async function markExtensionUpdateActionItemAvailable({
  version,
  storageArea = getSessionStorageArea(),
  now = Date.now,
}: ExtensionUpdatePersistenceInput = {}): Promise<void> {
  if (!storageArea) {
    return
  }

  const current = await readOptionsActionItems(storageArea)
  await storageArea.set({
    [SESSION_STORAGE_KEYS.optionsActionItems]: {
      ...current,
      ...createExtensionUpdateActionItem({ version, detectedAt: now() }),
    },
  })
}

export async function clearExtensionUpdateActionItem({
  storageArea = getSessionStorageArea(),
}: PersistOptionsActionItemsInput = {}): Promise<void> {
  if (!storageArea) {
    return
  }

  const current = await readOptionsActionItems(storageArea)
  const remaining = { ...current }
  delete remaining.extensionUpdate
  await storageArea.set({ [SESSION_STORAGE_KEYS.optionsActionItems]: remaining })
}
