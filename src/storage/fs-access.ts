/*
  File System Access helpers for selecting a download root and writing files.
  - Stores FileSystemDirectoryHandle in IndexedDB (structured clone via IDB allowed).
  - Provides writeBlobToPath() to save at subpaths under the chosen root.
  - No implicit fallbacks: callers must surface errors (permission denied, missing handle) explicitly.
*/

import logger from '@/src/runtime/logger';

// Types for TS without DOM lib: declare minimal types
// These are standard in modern browsers; MV3 offscreen/options have DOM.
export type DirHandle = FileSystemDirectoryHandle;
export type FileHandle = FileSystemFileHandle;

const DB_NAME = 'tako-fs';
const STORE = 'handles';
const KEY_ROOT = 'download-root';

// Open IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error('Failed to read IndexedDB'));
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to write IndexedDB'));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to delete IndexedDB entry'));
  });
}

export async function saveDownloadRootHandle(handle: DirHandle): Promise<void> {
  // FileSystem handles are serializable via structured cloning into IndexedDB
  await idbSet(KEY_ROOT, handle);
}

export async function loadDownloadRootHandle(): Promise<DirHandle | undefined> {
  try {
    const h = await idbGet<DirHandle>(KEY_ROOT);
    return h;
  } catch {
    return undefined;
  }
}

export async function clearDownloadRootHandle(): Promise<void> {
  await idbDelete(KEY_ROOT);
}

export async function verifyPermission(dir: DirHandle, writable = true): Promise<boolean> {
  try {
    // Type assertion for optional File System Access API methods
    type DirHandleWithPermissions = DirHandle & {
      queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
      requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    };
    
    const dirWithPerms = dir as DirHandleWithPermissions;
    const perm = await dirWithPerms.queryPermission?.({ mode: writable ? 'readwrite' : 'read' });
    if (perm === 'granted') return true;
    const req = await dirWithPerms.requestPermission?.({ mode: writable ? 'readwrite' : 'read' });
    return req === 'granted';
  } catch {
    return false;
  }
}

async function ensureSubdir(root: DirHandle, pathParts: string[]): Promise<DirHandle> {
  let dir = root;
  for (const part of pathParts) {
    const name = part.trim();
    if (!name) continue;
    dir = await dir.getDirectoryHandle(name, { create: true });
  }
  return dir;
}

/**
 * Check directory permissions before write operation
 * Throws specific error types for better UX:
 * - PermissionExpiredError: Permission was granted but expired
 * - DirectoryNotFoundError: Handle exists but directory was deleted
 * - Generic Error: Permission query/request failed
 */
export async function checkPermissionBeforeWrite(dir: DirHandle): Promise<void> {
  // Import error types dynamically to avoid circular dependency
  const { PermissionExpiredError, DirectoryNotFoundError } = await import('@/src/types/errors');
  
  try {
    // First, check if the directory still exists
    try {
      // Try to enumerate (permission-independent existence check)
      const entries = dir.entries();
      await entries.next();
    } catch (e) {
      // Directory handle is stale (directory was deleted/moved)
      throw new DirectoryNotFoundError(
        dir.name,
        { component: 'fs-access', operation: 'checkPermissionBeforeWrite' },
        e instanceof Error ? e : undefined
      );
    }
    
    // Type assertion for optional File System Access API methods
    type DirHandleWithPermissions = DirHandle & {
      queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
      requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    
    const dirWithPerms = dir as DirHandleWithPermissions;
    
    // Check current permission status
    const queryPerm = await dirWithPerms.queryPermission?.({ mode: 'readwrite' });
    
    if (queryPerm === 'granted') {
      // Permission still valid
      return;
    }
    
    if (queryPerm === 'prompt') {
      // Permission needs to be re-requested
      const requestPerm = await dirWithPerms.requestPermission?.({ mode: 'readwrite' });
      if (requestPerm === 'granted') {
        return;
      }
      // User denied permission request
      throw new PermissionExpiredError(
        { component: 'fs-access', operation: 'checkPermissionBeforeWrite' }
      );
    }
    
    // Permission explicitly denied
    throw new PermissionExpiredError(
      { component: 'fs-access', operation: 'checkPermissionBeforeWrite' }
    );
  } catch (e) {
    // Re-throw our custom errors
    if (e instanceof PermissionExpiredError || e instanceof DirectoryNotFoundError) {
      throw e;
    }
    // Wrap unknown errors
    throw new Error(`Permission check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Generate unique filename by appending (1), (2), etc. if file exists
 * Example: "Chapter 001.cbz" → "Chapter 001 (1).cbz" → "Chapter 001 (2).cbz"
 */
export async function generateUniqueFilename(dir: DirHandle, baseFilename: string): Promise<string> {
  // Split filename and extension
  const lastDot = baseFilename.lastIndexOf('.');
  const name = lastDot >= 0 ? baseFilename.substring(0, lastDot) : baseFilename;
  const ext = lastDot >= 0 ? baseFilename.substring(lastDot) : '';
  
  // Check if base filename exists
  let uniqueName = baseFilename;
  let counter = 1;
  
  while (true) {
    try {
      // Try to get file handle (throws if doesn't exist)
      await dir.getFileHandle(uniqueName);
      // File exists, try next number
      uniqueName = `${name} (${counter})${ext}`;
      counter++;
      if (counter > 999) {
        // Safety limit to prevent infinite loop
        throw new Error(`Cannot generate unique filename after 999 attempts for: ${baseFilename}`);
      }
    } catch {
      // File doesn't exist - this name is unique
      return uniqueName;
    }
  }
}

export async function writeBlobToPath(root: DirHandle, fullPath: string, blob: Blob, overwriteExisting: boolean = true): Promise<void> {
  // fullPath like "Root/Series/Vol/File.cbz" relative to chosen root; we ignore first path if redundant.
  const parts = fullPath.split('/').filter(Boolean);
  let fileName = parts.pop()!;
  const dir = await ensureSubdir(root, parts);
  
  // Generate unique filename when overwriting is disabled
  if (!overwriteExisting) {
    fileName = await generateUniqueFilename(dir, fileName);
    logger.debug(`📝 Generated unique filename: ${fileName}`);
  }
  
  // Type assertion for FileSystemFileHandle with createWritable method
  type FileHandleWithWritable = FileSystemFileHandle & {
    createWritable(): Promise<FileSystemWritableFileStream>;
  };
  
  const fh = await dir.getFileHandle(fileName, { create: true });
  const ws = await (fh as FileHandleWithWritable).createWritable();
  await ws.write(blob);
  await ws.close();
}

