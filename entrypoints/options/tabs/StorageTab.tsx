import React, { useCallback } from "react"

import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { SettingsSectionHeader } from "../components/primitives/SettingsSectionHeader"
import { DownloadDestinationSection } from "../components/DownloadDestinationSection"
import { ArchiveFormatPicker } from "../components/ArchiveFormatPicker"

import { StorageTemplates } from "./StorageTab-templates"

interface StorageTabProps {
  settings: ExtensionSettings
  onChange: (updates: Partial<ExtensionSettings>) => void
  selectedFolderName: string | null
  folderAccessRequired: boolean
  onGrantFolderAccess: () => Promise<boolean>
  onPickFolder: () => Promise<void>
  isPickingFolder: boolean
  isSaving: boolean
}

export function StorageTab({
  settings,
  onChange,
  selectedFolderName,
  folderAccessRequired,
  onGrantFolderAccess,
  onPickFolder,
  isPickingFolder,
  isSaving,
}: StorageTabProps) {
  const updateDownloads = useCallback(
    (updates: Partial<ExtensionSettings["downloads"]>) => {
      onChange({ downloads: { ...settings.downloads, ...updates } })
    },
    [onChange, settings.downloads]
  )

  const showNoArchiveWarning =
    settings.downloads.defaultFormat === "none" &&
    settings.downloads.destination === "downloads-api"

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        id="options-storage-heading"
        title={t("options_storage")}
      />

      {/* Output format and naming show the result before destination details. */}
      <div className="flex flex-col gap-2">
        <ArchiveFormatPicker
          showNoArchiveWarning={showNoArchiveWarning}
          value={settings.downloads.defaultFormat}
          onValueChange={(value) => updateDownloads({ defaultFormat: value })}
        />
      </div>

      <SettingsGroup title={t("options_fileNamingAndContents")}>
        <StorageTemplates
          downloads={settings.downloads}
          destinationName={
            settings.downloads.destination === "file-system-access"
              ? selectedFolderName || t("destination_taskFolder")
              : t("destination_taskChrome")
          }
          onChange={updateDownloads}
        />
      </SettingsGroup>

      <DownloadDestinationSection
        downloads={settings.downloads}
        selectedFolderName={selectedFolderName}
        folderAccessRequired={folderAccessRequired}
        onGrantFolderAccess={onGrantFolderAccess}
        isPickingFolder={isPickingFolder}
        isSaving={isSaving}
        onDownloadsChange={updateDownloads}
        onPickFolder={onPickFolder}
      />
    </div>
  )
}
