const folderSetupMessages = {
  other_tabs: "options_folderSetupOtherTabs",
  downloads_active: "options_folderSetupDownloadsActive",
  unavailable: "options_folderSetupUnavailable",
  temporary: "options_folderSetupTemporary",
} as const

type FolderSetupReason = keyof typeof folderSetupMessages

const FOLDER_SETUP_RESULT_PARAM = "folder-setup"
const FOLDER_SETUP_HANDLE_PARAM = "folder-setup-handle"

export function readFolderSetupResult(
  search: string
): FolderSetupReason | null {
  const result = new URLSearchParams(search).get(FOLDER_SETUP_RESULT_PARAM)
  return result !== null && Object.hasOwn(folderSetupMessages, result)
    ? (result as FolderSetupReason)
    : null
}

export function readVerifiedFolder(search: string): string | null {
  const query = new URLSearchParams(search)
  return query.get(FOLDER_SETUP_RESULT_PARAM) === "ready"
    ? query.get(FOLDER_SETUP_HANDLE_PARAM)
    : null
}

export function clearFolderSetupFeedback(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(FOLDER_SETUP_RESULT_PARAM)
  url.searchParams.delete(FOLDER_SETUP_HANDLE_PARAM)
  window.history.replaceState(window.history.state, "", url)
}

export function folderSetupMessage(reason: string | undefined): string {
  return reason && Object.hasOwn(folderSetupMessages, reason)
    ? folderSetupMessages[reason as FolderSetupReason]
    : folderSetupMessages.unavailable
}
