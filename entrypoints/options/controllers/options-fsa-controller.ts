import {
  clearDownloadRootHandle,
  loadDownloadRootHandle,
  saveDownloadRootHandle,
  verifyPermission,
  type DirHandle,
} from "@/src/storage/fs-access"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"

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
  private readonly mutations = new StorageMutationQueue()
  private mutationRevision = 0

  get revision(): number {
    return this.mutationRevision
  }

  async loadSaved(): Promise<DirHandle | null> {
    return (await loadDownloadRootHandle()) ?? null
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

  async save(handle: DirHandle): Promise<number> {
    const revision = ++this.mutationRevision
    await this.mutations.run(() => saveDownloadRootHandle(handle))
    return revision
  }

  async clear(): Promise<number> {
    const revision = ++this.mutationRevision
    await this.mutations.run(() => clearDownloadRootHandle())
    return revision
  }

  /**
   * Restore only when no newer FSA mutation was requested. The revision check
   * is repeated inside the queue so a repair requested while an older save is
   * still draining cannot be overwritten by this stale rollback.
   */
  async restore(
    handle: DirHandle | null,
    expectedRevision?: number
  ): Promise<boolean> {
    if (
      expectedRevision !== undefined &&
      this.mutationRevision !== expectedRevision
    ) {
      return false
    }

    const restoreRevision = ++this.mutationRevision
    return this.mutations.run(async () => {
      if (
        expectedRevision !== undefined &&
        this.mutationRevision !== restoreRevision
      ) {
        return false
      }
      if (handle) await saveDownloadRootHandle(handle)
      else await clearDownloadRootHandle()
      return true
    })
  }

  async grantSavedAccess(): Promise<FolderAccessResult> {
    const handle = await this.loadSaved()
    if (!handle) return { status: "missing" }
    if (!(await verifyPermission(handle, true))) return { status: "denied" }
    return { status: "granted", handle }
  }
}
