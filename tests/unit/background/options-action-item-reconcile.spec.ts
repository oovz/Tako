import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const mocks = vi.hoisted(() => ({
  checkDestinationHealth: vi.fn(async (): Promise<DestinationPreflight> => ({
    ready: true,
  })),
  hasIntegrationOptionalHostPermission: vi.fn(
    async (_integrationId: string): Promise<boolean> => true
  ),
}))

vi.mock("@/entrypoints/background/destination", () => ({
  checkDestinationHealth: mocks.checkDestinationHealth,
}))

vi.mock("@/src/site-integrations/host-permission-service", () => ({
  hasIntegrationOptionalHostPermission:
    mocks.hasIntegrationOptionalHostPermission,
}))

import {
  reconcileHostPermissionActionItem,
  reconcileFsaDestinationActionItem,
} from "@/entrypoints/background/options-action-item-reconcile"
import { parseStoredOptionsActionItems } from "@/src/runtime/options-action-items"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DestinationPreflight } from "@/entrypoints/background/destination"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { DownloadSettings } from "@/src/domain/settings/types"

interface SessionStorageStub {
  data: Record<string, unknown>
  get: (key: string) => Promise<Record<string, unknown>>
  set: (values: Record<string, unknown>) => Promise<void>
}

function createSessionStorageStub(
  initial: Record<string, unknown> = {}
): SessionStorageStub {
  const data: Record<string, unknown> = { ...initial }
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, values)
    }),
  }
}

let session: SessionStorageStub

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasIntegrationOptionalHostPermission.mockResolvedValue(true)
  session = createSessionStorageStub()
  vi.stubGlobal("chrome", { storage: { session } })
})

function settingsWithDestination(downloads: Partial<DownloadSettings>) {
  return {
    getSettings: vi.fn(async () => ({
      ...DEFAULT_SETTINGS,
      downloads: { ...DEFAULT_SETTINGS.downloads, ...downloads },
    })),
  } as unknown as Pick<SettingsRepository, "getSettings">
}

function storedItems() {
  return parseStoredOptionsActionItems(session.data)
}

describe("reconcileFsaDestinationActionItem", () => {
  it("does not let a slow folder check overwrite a later destination change", async () => {
    const oldCheck = Promise.withResolvers<DestinationPreflight>()
    const checkingOldFolder = Promise.withResolvers<void>()
    mocks.checkDestinationHealth.mockImplementationOnce(() => {
      checkingOldFolder.resolve()
      return oldCheck.promise
    })
    const settingsRepository = settingsWithDestination({
      destination: "file-system-access",
      customDirectoryHandleId: "old-handle",
    })
    const beforeSwitch = reconcileFsaDestinationActionItem({
      settingsRepository,
    })
    await checkingOldFolder.promise
    const afterSwitch = reconcileFsaDestinationActionItem({
      settingsRepository: settingsWithDestination({
        destination: "downloads-api",
      }),
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    oldCheck.resolve({ ready: false, reason: "folder_unavailable" })
    await Promise.all([beforeSwitch, afterSwitch])
    expect(storedItems().fsaDestination).toBeUndefined()
  })

  it("clears the item when the destination is the browser downloads API", async () => {
    session.data[SESSION_STORAGE_KEYS.fsaDestinationActionItem] = {
      issue: "unavailable",
      detectedAt: 1,
    }

    await reconcileFsaDestinationActionItem({
      settingsRepository: settingsWithDestination({
        destination: "downloads-api",
      }),
    })

    expect(mocks.checkDestinationHealth).not.toHaveBeenCalled()
    expect(storedItems()).toEqual({})
  })

  it("clears the item when the configured folder is healthy", async () => {
    session.data[SESSION_STORAGE_KEYS.fsaDestinationActionItem] = {
      issue: "permission_required",
      detectedAt: 1,
    }

    await reconcileFsaDestinationActionItem({
      settingsRepository: settingsWithDestination({
        destination: "file-system-access",
        customDirectoryHandleId: "handle-1",
      }),
    })

    expect(mocks.checkDestinationHealth).toHaveBeenCalledWith({
      kind: "file-system-access",
      handleId: "handle-1",
    })
    expect(storedItems()).toEqual({})
  })

  it.each([
    { reason: "permission_prompt" },
    { reason: "permission_denied" },
  ] as const)(
    "marks a warning item when access needs a gesture ($reason)",
    async ({ reason }) => {
      mocks.checkDestinationHealth.mockResolvedValueOnce({
        ready: false,
        reason,
      })

      await reconcileFsaDestinationActionItem({
        settingsRepository: settingsWithDestination({
          destination: "file-system-access",
          customDirectoryHandleId: "handle-1",
        }),
      })

      expect(storedItems()).toMatchObject({
        fsaDestination: { issue: "permission_required" },
      })
    }
  )

  it.each([
    { reason: "not_configured" },
    { reason: "folder_unavailable" },
    { reason: "unsupported" },
  ] as const)(
    "marks an error item when the folder is unusable ($reason)",
    async ({ reason }) => {
      mocks.checkDestinationHealth.mockResolvedValueOnce({
        ready: false,
        reason,
      })

      await reconcileFsaDestinationActionItem({
        settingsRepository: settingsWithDestination({
          destination: "file-system-access",
          customDirectoryHandleId: "handle-1",
        }),
      })

      expect(storedItems()).toMatchObject({
        fsaDestination: { issue: "unavailable" },
      })
    }
  )
})

describe("reconcileHostPermissionActionItem", () => {
  it("retains the earlier unresolved site when access is restored to the latest site", async () => {
    const granted = new Set<string>()
    mocks.hasIntegrationOptionalHostPermission.mockImplementation(async (id) =>
      granted.has(id)
    )

    await reconcileHostPermissionActionItem(["mangadex"])
    await reconcileHostPermissionActionItem(["manhuagui"])
    granted.add("manhuagui")
    await reconcileHostPermissionActionItem()

    expect(storedItems().hostPermission?.integrationIds).toEqual(["mangadex"])
  })

  it("does nothing without a stored item", async () => {
    await expect(reconcileHostPermissionActionItem()).resolves.toBeUndefined()
    expect(mocks.hasIntegrationOptionalHostPermission).not.toHaveBeenCalled()
  })

  it("clears the item when every stored integration has access again", async () => {
    session.data[SESSION_STORAGE_KEYS.hostPermissionActionItem] = {
      integrationIds: ["mangadex"],
      detectedAt: 1,
    }

    await reconcileHostPermissionActionItem()

    expect(mocks.hasIntegrationOptionalHostPermission).toHaveBeenCalledWith(
      "mangadex"
    )
    expect(storedItems()).toEqual({})
  })

  it("keeps the item while a stored integration still lacks access", async () => {
    session.data[SESSION_STORAGE_KEYS.hostPermissionActionItem] = {
      integrationIds: ["mangadex"],
      detectedAt: 1,
    }
    mocks.hasIntegrationOptionalHostPermission.mockResolvedValue(false)

    await reconcileHostPermissionActionItem()

    expect(storedItems()).toMatchObject({
      hostPermission: { integrationIds: ["mangadex"] },
    })
  })

  it("shrinks the item to the integrations still missing access", async () => {
    session.data[SESSION_STORAGE_KEYS.hostPermissionActionItem] = {
      integrationIds: ["manhuagui", "mangadex"],
      detectedAt: 1,
    }
    mocks.hasIntegrationOptionalHostPermission.mockImplementation(
      async (id: string) => id !== "mangadex"
    )

    await reconcileHostPermissionActionItem()

    expect(storedItems()).toMatchObject({
      hostPermission: { integrationIds: ["mangadex"] },
    })
  })
})
