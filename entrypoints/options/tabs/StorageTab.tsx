import React, { useCallback } from "react"
import { BookOpen, FileCheck, Hash, Image as ImageIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { validateTemplate } from "@/src/shared/template-expander"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { SettingsRow } from "../components/primitives/SettingsRow"
import { SettingsSectionHeader } from "../components/primitives/SettingsSectionHeader"
import { DownloadDestinationSection } from "../components/DownloadDestinationSection"
import { ArchiveFormatPicker } from "../components/ArchiveFormatPicker"
import { PathVisualization } from "../components/PathVisualization"

interface StorageTabProps {
  settings: ExtensionSettings
  onChange: (updates: Partial<ExtensionSettings>) => void
  selectedFolderName: string | null
  onPickFolder: () => Promise<void>
  isPickingFolder: boolean
  isSaving: boolean
}

const PATH_MACROS = [
  "<SERIES_TITLE>",
  "<CHAPTER_NUMBER>",
  "<CHAPTER_TITLE>",
  "<VOLUME_NUMBER>",
] as const

const FILENAME_MACROS = [
  "<CHAPTER_TITLE>",
  "<CHAPTER_NUMBER>",
  "<CHAPTER_NUMBER_PAD2>",
  "<CHAPTER_NUMBER_PAD3>",
  "<SERIES_TITLE>",
  "<VOLUME_NUMBER>",
] as const

export function StorageTab({
  settings,
  onChange,
  selectedFolderName,
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

  const pathIsValid = validateTemplate(settings.downloads.pathTemplate).valid
  const filenameIsValid = validateTemplate(
    settings.downloads.fileNameTemplate
  ).valid

  const insertPathMacro = (macro: string) => {
    const current = settings.downloads.pathTemplate || ""
    const updated =
      current.endsWith("/") || current.length === 0
        ? `${current}${macro}`
        : `${current}/${macro}`
    updateDownloads({ pathTemplate: updated })
  }

  const insertFilenameMacro = (macro: string) => {
    const current = settings.downloads.fileNameTemplate || ""
    const updated = current ? `${current} - ${macro}` : macro
    updateDownloads({ fileNameTemplate: updated })
  }

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

      {/* Group 3: Organization & Templates */}
      <SettingsGroup
        title={t("options_directoryPathTemplate")}
        description={t("options_directoryPathTemplateDesc")}
      >
        <div className="flex flex-col gap-5 p-4">
          {/* Directory Path Template */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="download-path" className="text-sm font-medium">
              {t("options_directoryPathTemplate")}
            </Label>
            <Input
              id="download-path"
              data-testid="download-path-input"
              value={settings.downloads.pathTemplate}
              aria-invalid={!pathIsValid}
              aria-describedby="download-path-help template-validation-status"
              onChange={(e) =>
                updateDownloads({ pathTemplate: e.target.value })
              }
              placeholder="<SERIES_TITLE>/<CHAPTER_TITLE>"
              className="font-mono text-sm"
            />
            {/* Interactive macro chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-xs text-muted-foreground mr-1">
                {t("options_pathTemplateMacros")}:
              </span>
              {PATH_MACROS.map((macro) => (
                <button
                  key={macro}
                  type="button"
                  onClick={() => insertPathMacro(macro)}
                  className="inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-150 hover:scale-[1.02] active:scale-[0.95] cursor-pointer"
                >
                  + {macro}
                </button>
              ))}
            </div>
          </div>

          {/* Filename Template */}
          <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <Label htmlFor="filename-template" className="text-sm font-medium">
              {t("options_filenameTemplate")}
            </Label>
            <Input
              id="filename-template"
              data-testid="filename-template-input"
              value={settings.downloads.fileNameTemplate}
              aria-invalid={!filenameIsValid}
              aria-describedby="filename-template-help template-validation-status"
              onChange={(e) =>
                updateDownloads({
                  fileNameTemplate: e.target.value || undefined,
                })
              }
              placeholder="<CHAPTER_TITLE>"
              className="font-mono text-sm"
            />
            {/* Interactive macro chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-xs text-muted-foreground mr-1">
                {t("options_filenameTemplateDesc")}:
              </span>
              {FILENAME_MACROS.map((macro) => (
                <button
                  key={macro}
                  type="button"
                  onClick={() => insertFilenameMacro(macro)}
                  className="inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-150 hover:scale-[1.02] active:scale-[0.95] cursor-pointer"
                >
                  + {macro}
                </button>
              ))}
            </div>
          </div>

          {/* Real-time Path Visualization */}
          <PathVisualization
            template={settings.downloads.pathTemplate}
            filenameTemplate={settings.downloads.fileNameTemplate}
            format={settings.downloads.defaultFormat}
          />
        </div>
      </SettingsGroup>

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
