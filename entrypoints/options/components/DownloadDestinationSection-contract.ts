import type { ExtensionSettings } from "@/src/domain/settings/types"

export interface FolderSetupAction {
  handleId: string
  finish: () => Promise<void>
  disabled: boolean
}

export interface DownloadDestinationSectionProps {
  downloads: ExtensionSettings["downloads"]
  selectedFolderName: string | null
  folderAccessRequired: boolean
  folderSetup?: FolderSetupAction
  onGrantFolderAccess: () => Promise<boolean>
  isPickingFolder: boolean
  isSaving: boolean
  onDownloadsChange: (updates: Partial<ExtensionSettings["downloads"]>) => void
  onPickFolder: () => Promise<void>
}
