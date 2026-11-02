import {
  DirectoryNotFoundError,
  PermissionExpiredError,
} from "@/src/types/errors"
/**
 * Store directory handles in IndexedDB and write beneath the selected root.
 * Permission and write failures propagate without changing the destination.
 */

import { parseSettingsDocument } from "@/src/domain/settings/schema"
import { SETTINGS_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import logger from "@/src/runtime/logger"
import type { ConflictPolicy } from "@/src/shared/download-contract"
import { probeDirectory } from "./fs-access-directory-probe"

export type DirHandle = FileSystemDirectoryHandle
export type FileHandle = FileSystemFileHandle

export const DOWNLOAD_ROOT_DB_NAME = "tako-fs"
export const DOWNLOAD_ROOT_STORE_NAME = "handles"
export const MANAGED_DOWNLOAD_ROOT_STORE_NAME = "managed-handles"
export const DOWNLOAD_ROOT_DB_VERSION = 2
export const DOWNLOAD_ROOT_HANDLE_ID = "download-root"

export interface FsaCapabilities {
  directoryPicker: boolean
  indexedDb: boolean
  handlePermissionQuery: boolean
  handlePermissionRequest: boolean
  writableFile: boolean
}

export function detectFsaCapabilities(): FsaCapabilities {
  const handlePrototype =
    typeof FileSystemHandle === "undefined"
      ? undefined
      : FileSystemHandle.prototype
  const fileHandlePrototype =
    typeof FileSystemFileHandle === "undefined"
      ? undefined
      : FileSystemFileHandle.prototype

  return {
    directoryPicker:
      typeof (globalThis as { showDirectoryPicker?: unknown })
        .showDirectoryPicker === "function",
    indexedDb: typeof indexedDB !== "undefined",
    handlePermissionQuery:
      !!handlePrototype && "queryPermission" in handlePrototype,
    handlePermissionRequest:
      !!handlePrototype && "requestPermission" in handlePrototype,
    writableFile:
      !!fileHandlePrototype && "createWritable" in fileHandlePrototype,
  }
}

export type FsaPermissionState = PermissionState | "unsupported" | "error"

export async function queryFsaPermission(
  dir: DirHandle,
  writable = true
): Promise<FsaPermissionState> {
  const handle = dir as DirHandle & {
    queryPermission?: (descriptor: {
      mode: "read" | "readwrite"
    }) => Promise<PermissionState>
  }

  if (typeof handle.queryPermission !== "function") {
    return "unsupported"
  }

  try {
    return await handle.queryPermission({
      mode: writable ? "readwrite" : "read",
    })
  } catch (error) {
    logger.debug("[fs-access] queryPermission failed:", error)
    return "error"
  }
}

// Open IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DOWNLOAD_ROOT_DB_NAME, DOWNLOAD_ROOT_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOWNLOAD_ROOT_STORE_NAME)) {
        db.createObjectStore(DOWNLOAD_ROOT_STORE_NAME)
      }
      if (!db.objectStoreNames.contains(MANAGED_DOWNLOAD_ROOT_STORE_NAME))
        db.createObjectStore(MANAGED_DOWNLOAD_ROOT_STORE_NAME)
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to open IndexedDB"))
  })
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  requestFactory: (
    store: IDBObjectStore,
    transaction: IDBTransaction
  ) => IDBRequest,
  getResult: (request: IDBRequest) => T,
  stores: string[] = [DOWNLOAD_ROOT_STORE_NAME]
): Promise<T> {
  const db = await openDB()
  try {
    const tx = db.transaction(stores, mode)
    const request = requestFactory(tx.objectStore(stores[0]), tx)
    return await waitForTransaction(tx, request, getResult)
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    db.close()
  }
}

function waitForTransaction<T>(
  tx: IDBTransaction,
  request: IDBRequest,
  getResult: (request: IDBRequest) => T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result!: T
    let requestError: DOMException | null = null
    let settled = false

    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }

    request.onsuccess = () => {
      result = getResult(request)
    }
    request.onerror = () => {
      requestError = request.error
    }
    tx.oncomplete = () => {
      if (requestError) {
        rejectOnce(requestError)
        return
      }
      if (settled) return
      settled = true
      resolve(result)
    }
    tx.onerror = () =>
      rejectOnce(
        requestError ?? tx.error ?? new Error("IndexedDB transaction failed")
      )
    tx.onabort = () =>
      rejectOnce(
        requestError ?? tx.error ?? new Error("IndexedDB transaction aborted")
      )
  })
}

async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  return runTransaction(
    "readonly",
    (store) => store.get(key),
    (request) => request.result as T | undefined
  )
}

async function idbAdd(key: string, value: unknown): Promise<void> {
  await runTransaction(
    "readwrite",
    (store) => store.add(value, key),
    () => undefined
  )
}

// A settings save stages a fresh ID, then commits that ID with the complete
// configuration. The selected capability is already durable at commit, so
// reopening Options or restarting the worker only needs to read the saved ID.
export async function saveDownloadRootHandle(
  handle: DirHandle,
  handleId: string
): Promise<void> {
  await idbAdd(handleId, handle)
}

/** Register a capability once the background accepts it as a durable reference. */
export async function adoptDownloadRootHandle(handleId: string): Promise<void> {
  await runTransaction(
    "readwrite",
    (store) => store.put(true, handleId),
    () => undefined,
    [MANAGED_DOWNLOAD_ROOT_STORE_NAME]
  )
}

/** Staged picker selections stay outside managed collection until accepted. */
export async function collectUnusedDownloadRootHandles(
  retainedIds: ReadonlySet<string>
): Promise<void> {
  const managed = await runTransaction(
    "readonly",
    (store) => store.getAllKeys(),
    (request) => request.result as string[],
    [MANAGED_DOWNLOAD_ROOT_STORE_NAME]
  )
  const unused = managed.filter((id) => !retainedIds.has(id))
  if (unused.length === 0) return
  await runTransaction(
    "readwrite",
    (handles, tx) => {
      const markers = tx.objectStore(MANAGED_DOWNLOAD_ROOT_STORE_NAME)
      let last!: IDBRequest
      for (const id of unused) {
        handles.delete(id)
        last = markers.delete(id)
      }
      return last
    },
    () => undefined,
    [DOWNLOAD_ROOT_STORE_NAME, MANAGED_DOWNLOAD_ROOT_STORE_NAME]
  )
}

export async function loadDownloadRootHandle(
  handleId?: string | null
): Promise<DirHandle | undefined> {
  if (handleId === undefined) {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEYS.global)
    handleId = parseSettingsDocument(stored[SETTINGS_STORAGE_KEYS.global])
      .downloads.customDirectoryHandleId
  }
  if (handleId === null) return undefined
  return idbGet<DirHandle>(handleId)
}

export async function verifyPermission(
  dir: DirHandle,
  writable = true
): Promise<boolean> {
  try {
    // Type assertion for optional File System Access API methods
    type DirHandleWithPermissions = DirHandle & {
      queryPermission?: (descriptor: {
        mode: "read" | "readwrite"
      }) => Promise<PermissionState>
      requestPermission?: (descriptor: {
        mode: "read" | "readwrite"
      }) => Promise<PermissionState>
    }

    const dirWithPerms = dir as DirHandleWithPermissions
    let perm = await dirWithPerms.queryPermission?.({
      mode: writable ? "readwrite" : "read",
    })
    if (perm !== "granted") {
      perm = await dirWithPerms.requestPermission?.({
        mode: writable ? "readwrite" : "read",
      })
    }
    if (perm !== "granted") return false

    await probeDirectory(dir)

    return true
  } catch (error) {
    // Permission API unavailable or threw (e.g. iframe sandbox, user gesture
    // required, or deleted folder). Treat as "no permission" but log so FSA failures are
    // debuggable instead of silently degrading to Downloads API.
    logger.debug("[fs-access] verifyPermission failed:", error)
    return false
  }
}

async function ensureSubdir(
  root: DirHandle,
  pathParts: string[]
): Promise<DirHandle> {
  let dir = root
  for (const part of pathParts) {
    const name = part.trim()
    if (!name) continue
    dir = await dir.getDirectoryHandle(name, { create: true })
  }
  return dir
}

/** Check write access and distinguish expired permission from a missing directory. */
export async function checkPermissionBeforeWrite(
  dir: DirHandle
): Promise<void> {
  try {
    // Directory enumeration itself is permission-gated. Query the stored
    // handle first so revoked access is not misreported as a missing folder.
    await assertWritePermission(dir)
    await probeWritableDirectory(dir)
  } catch (e) {
    // Re-throw our custom errors
    if (
      e instanceof PermissionExpiredError ||
      e instanceof DirectoryNotFoundError
    ) {
      throw e
    }
    if (isNamedError(e, "AbortError")) {
      throw e
    }
    // Wrap unknown errors
    throw new Error(
      `Permission check failed: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e }
    )
  }
}

async function assertWritePermission(dir: DirHandle): Promise<void> {
  const permission = await queryFsaPermission(dir, true)
  if (permission === "prompt" || permission === "denied") {
    throw new PermissionExpiredError({
      component: "fs-access",
      operation: "checkPermissionBeforeWrite",
    })
  }
  if (permission !== "granted") {
    throw new Error("Unable to query directory write permission")
  }
}

async function probeWritableDirectory(dir: DirHandle): Promise<void> {
  try {
    await dir.entries().next()
  } catch (error) {
    const context = {
      component: "fs-access",
      operation: "checkPermissionBeforeWrite",
    }
    if (isNotFoundError(error)) {
      throw new DirectoryNotFoundError(dir.name, context, error)
    }
    if (isNamedError(error, "NotAllowedError")) {
      // Access can be revoked after queryPermission succeeds.
      throw new PermissionExpiredError(context, error)
    }
    throw error
  }
}

type WriteBlobToPathOptions = {
  signal?: AbortSignal
  onBytesWritten?: (bytesWritten: number) => void | Promise<void>
}

function isNotFoundError(error: unknown): error is Error {
  return isNamedError(error, "NotFoundError")
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name
}

export type WriteBlobToPathResult = { status: "written" }

async function fileExists(dir: DirHandle, fileName: string): Promise<boolean> {
  try {
    await dir.getFileHandle(fileName)
    return true
  } catch (error) {
    if (isNotFoundError(error)) {
      return false
    }
    throw error
  }
}

async function resolveWriteTarget(
  dir: DirHandle,
  fileName: string,
  collisionPolicy: ConflictPolicy
): Promise<{ fileName: string; existed: boolean }> {
  const existed = await fileExists(dir, fileName)
  if (collisionPolicy !== "uniquify" || !existed) return { fileName, existed }

  const extensionIndex = fileName.lastIndexOf(".")
  const hasExtension = extensionIndex > 0
  const baseName = hasExtension ? fileName.slice(0, extensionIndex) : fileName
  const extension = hasExtension ? fileName.slice(extensionIndex) : ""
  for (let suffix = 1; ; suffix++) {
    const candidate = `${baseName} (${suffix})${extension}`
    if (!(await fileExists(dir, candidate))) {
      return { fileName: candidate, existed: false }
    }
  }
}

async function cleanupFailedWrite(
  dir: DirHandle,
  target: { fileName: string; existed: boolean },
  stream: FileSystemWritableFileStream | undefined
): Promise<void> {
  try {
    await stream?.abort()
  } catch {
    // Cleanup preserves the original write, close or cancellation error.
  }
  if (target.existed) return
  try {
    await dir.removeEntry(target.fileName)
  } catch {
    // A failed new entry may remain when the directory is unavailable.
  }
}

export async function writeBlobToPath(
  root: DirHandle,
  fullPath: string,
  blob: Blob,
  collisionPolicy: ConflictPolicy,
  options: WriteBlobToPathOptions = {}
): Promise<WriteBlobToPathResult> {
  // Every nonempty path segment is relative to the selected root.
  throwIfAborted(options.signal)
  const parts = fullPath.split("/").filter(Boolean)
  const requestedFileName = parts.pop()!
  const dir = await ensureSubdir(root, parts)

  throwIfAborted(options.signal)
  const target = await resolveWriteTarget(
    dir,
    requestedFileName,
    collisionPolicy
  )

  throwIfAborted(options.signal)

  // Type assertion for FileSystemFileHandle with createWritable method
  type FileHandleWithWritable = FileSystemFileHandle & {
    createWritable(options?: {
      keepExistingData?: boolean
    }): Promise<FileSystemWritableFileStream>
  }

  const fh = await dir.getFileHandle(target.fileName, { create: true })
  let ws: FileSystemWritableFileStream | undefined
  try {
    ws = await (fh as FileHandleWithWritable).createWritable({
      keepExistingData: false,
    })
    throwIfAborted(options.signal)
    if (!options.signal && !options.onBytesWritten) {
      await ws.write(blob)
    } else {
      await writeBlobStream(ws, blob, options)
    }
    throwIfAborted(options.signal)
    await ws.close()
    return { status: "written" }
  } catch (error) {
    await cleanupFailedWrite(dir, target, ws)
    throw error
  }
}

async function writeBlobStream(
  ws: FileSystemWritableFileStream,
  blob: Blob,
  options: WriteBlobToPathOptions
): Promise<void> {
  const reader = blob.stream().getReader()
  let completed = false
  let bytesWritten = 0

  try {
    while (true) {
      throwIfAborted(options.signal)
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!value || value.byteLength === 0) {
        continue
      }

      await ws.write(value)
      bytesWritten += value.byteLength
      await options.onBytesWritten?.(bytesWritten)
    }
    completed = true
  } finally {
    if (!completed) {
      try {
        await reader.cancel()
      } catch {
        // Preserve the stream's original failure.
      }
    }
    try {
      reader.releaseLock()
    } catch {
      // no-op
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("job-cancelled")
}
