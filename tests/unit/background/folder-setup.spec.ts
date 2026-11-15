import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { verifyFolderSetup } from "@/entrypoints/background/folder-setup"
import {
  completeFolderSetup,
  loadDownloadRootHandle,
  queryFsaPermission,
  readFolderSetupRequired,
} from "@/src/storage/fs-access"

vi.mock("@/src/storage/fs-access", () => ({
  completeFolderSetup: vi.fn(),
  loadDownloadRootHandle: vi.fn(),
  queryFsaPermission: vi.fn(),
  readFolderSetupRequired: vi.fn(),
}))

const origin = "chrome-extension://tako/"
const originUrl = `${origin}options.html?tab=storage`
const neutralUrl = "chrome://new-tab-page/"
const folderId = "saved-handle"

function setup() {
  vi.useFakeTimers()
  vi.mocked(readFolderSetupRequired).mockResolvedValue(true)
  vi.mocked(loadDownloadRootHandle).mockResolvedValue({
    name: "Downloads",
  } as FileSystemDirectoryHandle)
  let tabUrl = originUrl
  const update = vi.fn(async (_tabId: number, next: { url: string }) => {
    tabUrl = next.url
  })
  const query = vi.fn(async () => [{ id: 5, url: tabUrl }])
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => origin + path },
    tabs: { update, query, get: async () => ({ url: tabUrl }) },
  })
  const deps = {
    queueRepository: {
      getQueue: vi.fn().mockResolvedValue([]),
    },
    settingsRepository: {
      getSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          destination: "file-system-access",
          customDirectoryHandleId: folderId,
        },
      }),
    },
  }
  const sender = {
    tab: { id: 5, url: originUrl } as chrome.tabs.Tab,
  }
  return { deps, sender, update, query }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe("persistent folder setup", () => {
  it("keeps the folder pending when Chrome asks for access after the first visit", async () => {
    const { deps, sender, update } = setup()
    vi.mocked(queryFsaPermission).mockResolvedValue("prompt")
    const result = verifyFolderSetup(deps, { handleId: folderId }, sender)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual({ success: true })
    expect(completeFolderSetup).not.toHaveBeenCalled()
    expect(update.mock.calls).toEqual([
      [5, { url: neutralUrl }],
      [5, { url: originUrl }],
    ])
  })

  it("accepts access that stays granted outside all Tako pages", async () => {
    const { deps, sender, update } = setup()
    vi.mocked(queryFsaPermission).mockImplementation(async () => {
      expect(update.mock.calls).toEqual([[5, { url: neutralUrl }]])
      return "granted"
    })
    const result = verifyFolderSetup(
      deps,
      { handleId: folderId, afterApproval: true },
      sender
    )
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual({ success: true })
    expect(completeFolderSetup).toHaveBeenCalledWith(folderId)
    expect(update).toHaveBeenLastCalledWith(5, {
      url: `${originUrl}&folder-setup=ready&folder-setup-handle=${folderId}`,
    })
  })

  it("invites another approval when the user selected a temporary grant", async () => {
    const { deps, sender, update } = setup()
    vi.mocked(queryFsaPermission).mockResolvedValue("prompt")
    const result = verifyFolderSetup(
      deps,
      { handleId: folderId, afterApproval: true },
      sender
    )
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual({ success: true })
    expect(completeFolderSetup).not.toHaveBeenCalled()
    expect(update).toHaveBeenLastCalledWith(5, {
      url: `${originUrl}&folder-setup=temporary`,
    })
  })

  it("does not end the visit while another Tako tab is open", async () => {
    const { deps, sender, update, query } = setup()
    query.mockResolvedValue([{ id: 6, url: originUrl }])
    await expect(
      verifyFolderSetup(deps, { handleId: folderId }, sender)
    ).resolves.toEqual({ success: false, reason: "other_tabs" })
    expect(update).not.toHaveBeenCalled()
  })

  it("does not revoke a folder grant needed by queued downloads", async () => {
    const { deps, sender, update } = setup()
    deps.queueRepository.getQueue.mockResolvedValue([
      {
        status: "queued",
        settingsSnapshot: {
          destination: { kind: "file-system-access", handleId: "other-folder" },
        },
      } as DownloadTaskState,
    ])
    await expect(
      verifyFolderSetup(deps, { handleId: folderId }, sender)
    ).resolves.toEqual({ success: false, reason: "downloads_active" })
    expect(update).not.toHaveBeenCalled()
  })
})
