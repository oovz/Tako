import {
  AlertTriangle,
  FileDigit,
  Folder,
  FolderCheck,
  HardDrive,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"
import { detectFsaCapabilities } from "@/src/storage/fs-access"
import { SettingsGroup } from "./primitives/SettingsGroup"
import { SettingsRow } from "./primitives/SettingsRow"

interface DownloadDestinationSectionProps {
  downloads: ExtensionSettings["downloads"]
  selectedFolderName: string | null
  isPickingFolder: boolean
  isSaving: boolean
  onDownloadsChange: (updates: Partial<ExtensionSettings["downloads"]>) => void
  onPickFolder: () => Promise<void>
}

export function DownloadDestinationSection({
  downloads,
  selectedFolderName,
  isPickingFolder,
  isSaving,
  onDownloadsChange,
  onPickFolder,
}: DownloadDestinationSectionProps) {
  const fsaCapabilities = detectFsaCapabilities()
  const fsaSupported =
    fsaCapabilities.directoryPicker &&
    fsaCapabilities.indexedDb &&
    fsaCapabilities.handlePermissionQuery &&
    fsaCapabilities.handlePermissionRequest &&
    fsaCapabilities.writableFile

  const isFsaActive = downloads.destination === "file-system-access"

  return (
    <SettingsGroup
      title={t("options_downloadDestination")}
      description={t("options_conflictPolicyHelp")}
    >
      {/* Destination Switch Row */}
      <SettingsRow
        icon={isFsaActive ? FolderCheck : HardDrive}
        title={t("options_useCustomFolder")}
        description={
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-xs text-muted-foreground">
              {selectedFolderName
                ? t("options_currentFolder", [selectedFolderName])
                : isFsaActive
                  ? t("options_noFolderSelected")
                  : t("options_noCustomFolder")}
            </p>

            {/* Folder Actions when FSA is enabled or folder is present */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPickFolder}
                disabled={isSaving || isPickingFolder || !fsaSupported}
                className="h-8 text-xs gap-1.5"
              >
                <Folder data-icon="inline-start" className="size-3.5" />
                {selectedFolderName
                  ? t("options_changeFolder")
                  : t("options_selectFolder")}
              </Button>
              {selectedFolderName && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onDownloadsChange({
                      destination: "downloads-api",
                      customDirectoryHandleId: null,
                    })
                  }}
                  disabled={isSaving}
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("options_useBrowserDownloads")}
                </Button>
              )}
            </div>

            {/* FSA Unsupported Warning */}
            {!fsaSupported && (
              <p className="text-xs text-destructive">
                {t("options_fsaUnsupported")}
              </p>
            )}

            {/* FSA Active but No Folder Warning */}
            {isFsaActive && !selectedFolderName && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs font-semibold">
                    {t("options_fsaNoFolderSelectedTitle")}
                  </p>
                  <p className="text-xs opacity-90">
                    {t("options_fsaNoFolderSelectedDesc")}
                  </p>
                </div>
              </div>
            )}
          </div>
        }
        htmlFor="custom-folder-switch"
        align="start"
        control={
          <Switch
            id="custom-folder-switch"
            checked={isFsaActive}
            disabled={isSaving || (!fsaSupported && !isFsaActive)}
            onCheckedChange={(checked) => {
              onDownloadsChange({
                destination: checked ? "file-system-access" : "downloads-api",
                customDirectoryHandleId: checked
                  ? downloads.customDirectoryHandleId
                  : null,
              })
            }}
          />
        }
      />
      {/* Suppress Save As Dialog Row (Browser Downloads only) */}
      <SettingsRow
        icon={FileDigit}
        title={t("options_suppressSaveAs")}
        description={t("options_suppressSaveAsDesc")}
        htmlFor="suppress-save-as"
        control={
          <Switch
            id="suppress-save-as"
            data-testid="suppress-save-as-switch"
            checked={downloads.suppressSaveAsDialog}
            disabled={isSaving || isFsaActive}
            onCheckedChange={(checked) =>
              onDownloadsChange({ suppressSaveAsDialog: checked })
            }
          />
        }
      />

      {/* Conflict Policy Row */}
      <SettingsRow
        title={t("options_conflictPolicy")}
        description={t("options_conflictPolicyHelp")}
        htmlFor="collision-policy"
        control={
          <Select
            value={downloads.conflictPolicy}
            onValueChange={(value: "overwrite" | "uniquify") =>
              onDownloadsChange({ conflictPolicy: value })
            }
          >
            <SelectTrigger id="collision-policy" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="uniquify">
                {t("options_conflictUniquify")}
              </SelectItem>
              <SelectItem value="overwrite">
                {t("options_conflictOverwrite")}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroup>
  )
}
