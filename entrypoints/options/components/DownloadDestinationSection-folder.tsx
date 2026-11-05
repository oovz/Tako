import { AlertTriangle, Folder } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { detectFsaCapabilities } from "@/src/storage/fs-access"
import { SettingsRow } from "./primitives/SettingsRow"
import { t } from "@/src/runtime/i18n"
import type { DownloadDestinationSectionProps } from "./DownloadDestinationSection-contract"

type FolderDetailsProps = DownloadDestinationSectionProps & {
  isFsaActive: boolean
  fsaSupported: boolean
}
function folderDescription(
  selectedFolderName: string | null,
  isFsaActive: boolean
) {
  if (selectedFolderName)
    return t("options_currentFolder", [selectedFolderName])
  return t(isFsaActive ? "options_noFolderSelected" : "options_noCustomFolder")
}

function DownloadFolderActions({
  selectedFolderName,
  onPickFolder,
  isSaving,
  isPickingFolder,
  fsaSupported,
  onDownloadsChange,
}: FolderDetailsProps) {
  return (
    <>
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
    </>
  )
}

function DownloadFolderAccessRepair({
  isFsaActive,
  folderAccessRequired,
  selectedFolderName,
  isSaving,
  isPickingFolder,
  onGrantFolderAccess,
}: FolderDetailsProps) {
  return (
    <>
      {isFsaActive && folderAccessRequired && selectedFolderName && (
        <div role="alert" className="text-xs text-destructive">
          <p>{t("options_savedFolderRepairRequired")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving || isPickingFolder}
            onClick={() => void onGrantFolderAccess()}
          >
            {t("folderAccess_grant")}
          </Button>
        </div>
      )}
    </>
  )
}

function DownloadFolderMissing({
  isFsaActive,
  selectedFolderName,
}: FolderDetailsProps) {
  return (
    <>
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
    </>
  )
}

function DownloadFolderDetails(props: FolderDetailsProps) {
  const { selectedFolderName, isFsaActive, fsaSupported } = props
  return (
    <div className="flex flex-col gap-2 mt-1">
      <p className="text-xs text-muted-foreground">
        {folderDescription(selectedFolderName, isFsaActive)}
      </p>
      <DownloadFolderActions {...props} />
      {/* FSA Unsupported Warning */}
      {!fsaSupported && (
        <p className="text-xs text-destructive">
          {t("options_fsaUnsupported")}
        </p>
      )}

      <DownloadFolderAccessRepair {...props} />
      <DownloadFolderMissing {...props} />
    </div>
  )
}

function supportsFolderDestination(
  capabilities: ReturnType<typeof detectFsaCapabilities>
): boolean {
  return (
    capabilities.directoryPicker &&
    capabilities.indexedDb &&
    capabilities.handlePermissionQuery &&
    capabilities.handlePermissionRequest &&
    capabilities.writableFile
  )
}

export function DownloadFolderDestination(
  props: DownloadDestinationSectionProps
) {
  const { downloads, isSaving, onDownloadsChange } = props
  const fsaSupported = supportsFolderDestination(detectFsaCapabilities())
  const isFsaActive = downloads.destination === "file-system-access"
  return (
    <>
      {/* Destination Switch Row */}
      <SettingsRow
        title={t("options_useCustomFolder")}
        description={
          <DownloadFolderDetails
            {...props}
            isFsaActive={isFsaActive}
            fsaSupported={fsaSupported}
          />
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
      {isFsaActive && (
        <SettingsRow
          title={t("options_allowChromeFallback")}
          description={t("options_allowChromeFallbackHelp")}
          htmlFor="allow-chrome-fallback"
          control={
            <Switch
              id="allow-chrome-fallback"
              checked={downloads.allowChromeFallback}
              disabled={isSaving}
              onCheckedChange={(allowChromeFallback) =>
                onDownloadsChange({ allowChromeFallback })
              }
            />
          }
        />
      )}
    </>
  )
}
