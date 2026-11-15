import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import logger from "@/src/runtime/logger"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import {
  completeFolderSetup,
  loadDownloadRootHandle,
  queryFsaPermission,
  readFolderSetupRequired,
} from "@/src/storage/fs-access"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import { runDestinationAccessExclusive } from "./destination-access"

const neutralPage = "chrome://new-tab-page/"

type SetupResult = RuntimeMessageResponse<"VERIFY_FOLDER_SETUP">
type UnavailableReason = "other_tabs" | "downloads_active" | "unavailable"
type FolderSetupOutcome = UnavailableReason | "temporary" | "ready"

interface FolderSetupDependencies {
  queueRepository: Pick<QueueRepository, "getQueue">
  settingsRepository: Pick<SettingsRepository, "getSettings">
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function optionsPage(url: string | undefined): boolean {
  return Boolean(
    url && url.split(/[?#]/, 1)[0] === chrome.runtime.getURL("options.html")
  )
}

function isNeutralTab(tab: chrome.tabs.Tab): boolean {
  return (
    tab.url === neutralPage &&
    (tab.pendingUrl === undefined || tab.pendingUrl === neutralPage)
  )
}

async function hasOtherTakoTab(ignoredId?: number): Promise<boolean> {
  const origin = chrome.runtime.getURL("")
  return (await chrome.tabs.query({})).some(
    (tab) =>
      tab.id !== ignoredId &&
      (tab.url?.startsWith(origin) || tab.pendingUrl?.startsWith(origin))
  )
}

async function waitForNeutralPage(tabId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const tab = await chrome.tabs.get(tabId)
    if (isNeutralTab(tab)) return true
    if (!optionsPage(tab.url) && tab.pendingUrl !== neutralPage) return false
    await pause(80)
  }
  return false
}

async function returnToStorage(
  tabId: number,
  handleId: string,
  outcome: FolderSetupOutcome | undefined
): Promise<void> {
  const tab = await chrome.tabs.get(tabId)
  if (!isNeutralTab(tab) && tab.pendingUrl !== neutralPage) return
  const query = new URLSearchParams({ tab: "storage" })
  if (outcome) query.set("folder-setup", outcome)
  if (outcome === "ready") query.set("folder-setup-handle", handleId)
  await chrome.tabs.update(tabId, {
    url: chrome.runtime.getURL(`options.html?${query}`),
  })
}

async function verifyFromNeutralPage(
  tabId: number,
  {
    handleId,
    afterApproval,
  }: RuntimeMessageRequest<"VERIFY_FOLDER_SETUP">["payload"]
): Promise<FolderSetupOutcome | undefined> {
  if (!(await waitForNeutralPage(tabId))) return "unavailable"
  // Chrome clears temporary grants asynchronously after the last page leaves.
  // Give that browser-side cleanup time to run before querying the saved handle.
  await pause(500)
  if (!isNeutralTab(await chrome.tabs.get(tabId))) return "unavailable"
  if (await hasOtherTakoTab()) return "other_tabs"
  const handle = await loadDownloadRootHandle(handleId)
  if (!handle) return "unavailable"
  const permission = await queryFsaPermission(handle)
  if (permission === "granted") {
    if (await hasOtherTakoTab()) return "other_tabs"
    await completeFolderSetup(handleId)
    return "ready"
  }
  if (permission === "prompt") return afterApproval ? "temporary" : undefined
  return "unavailable"
}

async function verifyInSameTab(
  tabId: number,
  payload: RuntimeMessageRequest<"VERIFY_FOLDER_SETUP">["payload"]
): Promise<SetupResult> {
  await chrome.tabs.update(tabId, { url: neutralPage })
  let outcome: FolderSetupOutcome | undefined = "unavailable"
  try {
    outcome = await verifyFromNeutralPage(tabId, payload)
  } catch (error) {
    logger.warn("Could not verify the saved folder's persistent access", error)
  } finally {
    await returnToStorage(tabId, payload.handleId, outcome)
  }
  return { success: true }
}

export function verifyFolderSetup(
  deps: FolderSetupDependencies,
  payload: RuntimeMessageRequest<"VERIFY_FOLDER_SETUP">["payload"],
  sender: chrome.runtime.MessageSender
): Promise<SetupResult> {
  return runDestinationAccessExclusive(async () => {
    const tabId = sender.tab?.id
    if (tabId === undefined) return { success: false, reason: "unavailable" }
    const { downloads } = await deps.settingsRepository.getSettings()
    if (
      downloads.destination !== "file-system-access" ||
      downloads.customDirectoryHandleId !== payload.handleId
    ) {
      return { success: false, reason: "unavailable" }
    }
    if (!(await readFolderSetupRequired(payload.handleId)))
      return { success: true }
    // Leaving the last extension tab can expire temporary access for every
    // selected folder. Keep the current grant in place while folder work exists.
    const queue = await deps.queueRepository.getQueue()
    if (
      queue.some(
        (task) =>
          (task.status === "queued" || task.status === "downloading") &&
          getEffectiveTaskDestination(task).kind === "file-system-access"
      )
    ) {
      return { success: false, reason: "downloads_active" }
    }
    if (await hasOtherTakoTab(tabId))
      return { success: false, reason: "other_tabs" }
    const tab = await chrome.tabs.get(tabId)
    if (!optionsPage(tab.url) || tab.pendingUrl !== undefined)
      return { success: false, reason: "unavailable" }
    return verifyInSameTab(tabId, payload)
  })
}
