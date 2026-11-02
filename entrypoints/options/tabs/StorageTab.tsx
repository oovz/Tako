import React, { useCallback } from "react"
import { BookOpen, FileCheck, Hash, Image as ImageIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { SettingsRow } from "../components/primitives/SettingsRow"
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
        description={t("options_storageFormatsDesc")}
      />

      {/* Group 1: Download Destination (FSA vs Chrome Downloads API) */}
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

      {/* Group 2: Archive Format */}
      <div className="flex flex-col gap-2">
        <ArchiveFormatPicker
          showNoArchiveWarning={showNoArchiveWarning}
          value={settings.downloads.defaultFormat}
          onValueChange={(value) => updateDownloads({ defaultFormat: value })}
        />
      </div>

      <StorageTemplates
        downloads={settings.downloads}
        onChange={updateDownloads}
      />

      {/* Group 4: Metadata & File Options */}
      <SettingsGroup
        title={t("options_storageFormats")}
        description={t("options_storageFormatsDesc")}
      >
        <SettingsRow
          icon={BookOpen}
          title={t("options_includeComicInfo")}
          description={t("options_includeComicInfoDesc")}
          htmlFor="comicinfo"
          control={
            <Switch
              id="comicinfo"
              data-testid="comicinfo-switch"
              checked={settings.downloads.includeComicInfo}
              onCheckedChange={(checked) =>
                updateDownloads({ includeComicInfo: checked })
              }
            />
          }
        />

        <SettingsRow
          icon={ImageIcon}
          title={t("options_includeCover")}
          description={t("options_includeCoverDesc")}
          htmlFor="cover-image"
          control={
            <Switch
              id="cover-image"
              data-testid="cover-image-switch"
              checked={settings.downloads.includeCoverImage}
              onCheckedChange={(checked) =>
                updateDownloads({ includeCoverImage: checked })
              }
            />
          }
        />

        <SettingsRow
          icon={FileCheck}
          title={t("options_normalizeFilenames")}
          description={t("options_normalizeFilenamesDesc")}
          htmlFor="normalize"
          control={
            <Switch
              id="normalize"
              data-testid="normalize-switch"
              checked={settings.downloads.normalizeImageFilenames}
              onCheckedChange={(checked) =>
                updateDownloads({ normalizeImageFilenames: checked })
              }
            />
          }
        />

        <SettingsRow
          icon={Hash}
          title={t("options_imagePadding")}
          description={t("options_imagePaddingDesc")}
          htmlFor="image-padding"
          control={
            <Select
              value={String(settings.downloads.imagePaddingDigits ?? "auto")}
              onValueChange={(value) =>
                updateDownloads({
                  imagePaddingDigits:
                    value === "auto"
                      ? "auto"
                      : (parseInt(value) as 2 | 3 | 4 | 5),
                })
              }
            >
              <SelectTrigger
                id="image-padding"
                data-testid="image-padding-select"
                className="w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("options_paddingAuto")}</SelectItem>
                <SelectItem value="2">{t("options_padding2")}</SelectItem>
                <SelectItem value="3">{t("options_padding3")}</SelectItem>
                <SelectItem value="4">{t("options_padding4")}</SelectItem>
                <SelectItem value="5">{t("options_padding5")}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroup>
    </div>
  )
}
