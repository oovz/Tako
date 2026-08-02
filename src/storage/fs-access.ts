/*
  File System Access helpers for selecting a download root and writing files.
  - Stores FileSystemDirectoryHandle in IndexedDB (structured clone via IDB allowed).
  - Provides writeBlobToPath() to save at subpaths under the chosen root.
  - No implicit fallbacks: callers must surface errors (permission denied, missing handle) explicitly.
*/

import logger from "@/src/runtime/logger"
import type { ConflictPolicy } from "@/src/shared/download-contract"

// Types for TS without DOM lib: declare minimal types
// These are standard in modern browsers; MV3 offscreen/options have DOM.
export type DirHandle = FileSystemDirectoryHandle
export type FileHandle = FileSystemFileHandle

export const DOWNLOAD_ROOT_DB_NAME = "tako-fs"
export const DOWNLOAD_ROOT_STORE_NAME = "handles"
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
    const req = indexedDB.open(DOWNLOAD_ROOT_DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOWNLOAD_ROOT_STORE_NAME)) {
        db.createObjectStore(DOWNLOAD_ROOT_STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to open IndexedDB"))
  })
}

async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOAD_ROOT_STORE_NAME, "readonly")
    const store = tx.objectStore(DOWNLOAD_ROOT_STORE_NAME)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to read IndexedDB"))
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB read transaction failed"))
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB read transaction aborted"))
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOAD_ROOT_STORE_NAME, "readwrite")
    const req = tx.objectStore(DOWNLOAD_ROOT_STORE_NAME).put(value, key)
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to write IndexedDB"))
    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB write transaction failed"))
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB write transaction aborted"))
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOAD_ROOT_STORE_NAME, "readwrite")
    const req = tx.objectStore(DOWNLOAD_ROOT_STORE_NAME).delete(key)
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to delete IndexedDB entry"))
    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB delete transaction failed"))
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB delete transaction aborted"))
  })
}

export async function saveDownloadRootHandle(handle: DirHandle): Promise<void> {
  // FileSystem handles are serializable via structured cloning into IndexedDB
  await idbSet(DOWNLOAD_ROOT_HANDLE_ID, handle)
}

export async function loadDownloadRootHandle(): Promise<DirHandle | undefined> {
  return idbGet<DirHandle>(DOWNLOAD_ROOT_HANDLE_ID)
}

export async function clearDownloadRootHandle(): Promise<void> {
  await idbDelete(DOWNLOAD_ROOT_HANDLE_ID)
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
    const perm = await dirWithPerms.queryPermission?.({
      mode: writable ? "readwrite" : "read",
    })
    if (perm === "granted") return true
    const req = await dirWithPerms.requestPermission?.({
      mode: writable ? "readwrite" : "read",
    })
    return req === "granted"
  } catch (error) {
    // Permission API unavailable or threw (e.g. iframe sandbox, user gesture
    // required). Treat as "no permission" but log so FSA failures are
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

/**
 * Check directory permissions before write operation
 * Throws specific error types for better UX:
 * - PermissionExpiredError: Permission was granted but expired
 * - DirectoryNotFoundError: Handle exists but directory was deleted
 * - Generic Error: Permission query/request failed
 */
export async function checkPermissionBeforeWrite(
  dir: DirHandle
): Promise<void> {
  // Import error types dynamically to avoid circular dependency
  const { PermissionExpiredError, DirectoryNotFoundError } =
    await import("@/src/types/errors")

  try {
    // Directory enumeration itself is permission-gated. Query the stored
    // handle first so revoked access is not misreported as a missing folder.
    const permission = await queryFsaPermission(dir, true)
    if (permission !== "granted") {
      throw new PermissionExpiredError({
        component: "fs-access",
        operation: "checkPermissionBeforeWrite",
      })
    }

    try {
      const entries = dir.entries()
      await entries.next()
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new DirectoryNotFoundError(
          dir.name,
          { component: "fs-access", operation: "checkPermissionBeforeWrite" },
          error
        )
      }
      if (isNamedError(error, "NotAllowedError")) {
        // Permission can be revoked between queryPermission() and the first
        // directory operation.
        throw new PermissionExpiredError(
          { component: "fs-access", operation: "checkPermissionBeforeWrite" },
          error
        )
      }
      if (isNamedError(error, "AbortError")) {
        throw error
      }
      throw error
    }
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

export async function writeBlobToPath(
  root: DirHandle,
  fullPath: string,
  blob: Blob,
  collisionPolicy: ConflictPolicy,
  options: WriteBlobToPathOptions = {}
): Promise<WriteBlobToPathResult> {
  // fullPath like "Root/Series/Vol/File.cbz" relative to chosen root; we ignore first path if redundant.
  throwIfAborted(options.signal)
  const parts = fullPath.split("/").filter(Boolean)
  let fileName = parts.pop()!
  const dir = await ensureSubdir(root, parts)

  throwIfAborted(options.signal)
  if (collisionPolicy === "uniquify" && (await fileExists(dir, fileName))) {
    const extensionIndex = fileName.lastIndexOf(".")
    const hasExtension = extensionIndex > 0
    const baseName = hasExtension ? fileName.slice(0, extensionIndex) : fileName
    const extension = hasExtension ? fileName.slice(extensionIndex) : ""
    for (let suffix = 1; ; suffix++) {
      const candidate = `${baseName} (${suffix})${extension}`
      if (!(await fileExists(dir, candidate))) {
        fileName = candidate
        break
      }
    }
  }

  // Type assertion for FileSystemFileHandle with createWritable method
  type FileHandleWithWritable = FileSystemFileHandle & {
    createWritable(options?: {
      keepExistingData?: boolean
    }): Promise<FileSystemWritableFileStream>
  }

  const fh = await dir.getFileHandle(fileName, { create: true })
  const ws = await (fh as FileHandleWithWritable).createWritable({
    keepExistingData: false,
  })
  if (!options.signal && !options.onBytesWritten) {
    await ws.write(blob)
    await ws.close()
    return { status: "written" }
  }

  await writeBlobStream(ws, blob, options)
  return { status: "written" }
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
    try {
      reader.releaseLock()
    } catch {
      // no-op
    }

    if (completed) {
      await ws.close()
    } else {
      try {
        await ws.abort()
      } catch {
        // no-op
      }
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
