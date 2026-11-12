import {
  loadDownloadRootHandle,
  saveDownloadRootHandle,
  verifyPermission,
  type DirHandle,
} from "@/src/storage/fs-access"
import { refreshFolderActionItem } from "@/src/runtime/refresh-folder-action-item"

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

  async grantSavedAccess(
    handleId?: string | null
  ): Promise<FolderAccessResult> {
    const handle = await this.loadSaved(handleId)
    if (!handle) return { status: "missing" }
    if (!(await verifyPermission(handle, true))) return { status: "denied" }
    void refreshFolderActionItem()
    return { status: "granted", handle }
  }
}
