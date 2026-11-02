import type { ExtensionSettings } from "@/src/domain/settings/types"

export interface DownloadDestinationSectionProps {
  downloads: ExtensionSettings["downloads"]
  selectedFolderName: string | null
  folderAccessRequired: boolean
  onGrantFolderAccess: () => Promise<boolean>
  isPickingFolder: boolean
  isSaving: boolean
  onDownloadsChange: (updates: Partial<ExtensionSettings["downloads"]>) => void
  onPickFolder: () => Promise<void>
}
