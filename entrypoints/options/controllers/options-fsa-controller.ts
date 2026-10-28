import {
  loadDownloadRootHandle,
  saveDownloadRootHandle,
  verifyPermission,
  type DirHandle,
} from "@/src/storage/fs-access"
import { parseSettingsDocument } from "@/src/domain/settings/schema"
import { SETTINGS_STORAGE_KEYS } from "@/src/runtime/storage-keys"

type DirectoryPicker = () => Promise<FileSystemDirectoryHandle>

export type FolderAccessResult =
  | { status: "missing" }
  | { status: "denied" }
  | { status: "granted"; handle: DirHandle }

export type FolderRequestResult =
  | { status: "unsupported" | "aborted" | "denied" }
  | { status: "granted"; handle: DirHandle }

function getDirectoryPicker(): DirectoryPicker | undefined {
  return (
    window as Window & {
      showDirectoryPicker?: DirectoryPicker
    }
  ).showDirectoryPicker
}

/** Owns the browser File System Access boundary used by Options. */
export class OptionsFsaController {
  private mutationRevision = 0

  get revision(): number {
    return this.mutationRevision
  }

  async loadSaved(handleId?: string | null): Promise<DirHandle | null> {
    return (await loadDownloadRootHandle(handleId)) ?? null
  }

  async requestFromUser(): Promise<FolderRequestResult> {
    const picker = getDirectoryPicker()
    if (!picker) return { status: "unsupported" }

    const handle = await picker().catch((error: unknown) => {
      const normalized = error as { name?: string; code?: number }
      if (
        normalized &&
        (normalized.name === "AbortError" || normalized.code === 20)
      ) {
        return null
      }
      throw error
    })
    if (!handle) return { status: "aborted" }
    if (!(await verifyPermission(handle, true))) return { status: "denied" }
    return { status: "granted", handle }
  }

  async stage(handle: DirHandle, handleId: string): Promise<void> {
    await saveDownloadRootHandle(handle, handleId)
  }

  async repair(handle: DirHandle): Promise<void> {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEYS.global)
    const handleId = parseSettingsDocument(stored[SETTINGS_STORAGE_KEYS.global])
      .downloads.customDirectoryHandleId
    if (!handleId) throw new Error("Custom folder is not configured")
    ++this.mutationRevision
    await saveDownloadRootHandle(handle, handleId)
  }

  async grantSavedAccess(): Promise<FolderAccessResult> {
    const handle = await this.loadSaved()
    if (!handle) return { status: "missing" }
    if (!(await verifyPermission(handle, true))) return { status: "denied" }
    ++this.mutationRevision
    return { status: "granted", handle }
  }
}
