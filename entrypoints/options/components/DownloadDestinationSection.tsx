import { Folder } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
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

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t("options_downloadDestination")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex flex-col gap-1 pr-4">
            <Label htmlFor="custom-folder-switch">
              {t("options_useCustomFolder")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {selectedFolderName
                ? t("options_currentFolder", [selectedFolderName])
                : t("options_noCustomFolder")}
            </p>
          </div>
          <Switch
            id="custom-folder-switch"
            checked={downloads.destination === "file-system-access"}
            disabled={
              isSaving ||
              (!fsaSupported && downloads.destination !== "file-system-access")
            }
            onCheckedChange={(checked) => {
              onDownloadsChange({
                destination: checked ? "file-system-access" : "downloads-api",
                // Browser Downloads must not retain a directory-handle id in
                // the settings document. The save flow uses this as the
                // durable intent to remove the corresponding IndexedDB handle.
                customDirectoryHandleId: checked
                  ? downloads.customDirectoryHandleId
                  : null,
              })
            }}
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onPickFolder}
            disabled={isSaving || isPickingFolder || !fsaSupported}
          >
            <Folder data-icon="inline-start" className="size-3.5" />
            {selectedFolderName
              ? t("options_changeFolder")
              : t("options_selectFolder")}
          </Button>
          {selectedFolderName && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDownloadsChange({
                  destination: "downloads-api",
                  customDirectoryHandleId: null,
                })
              }}
              disabled={isSaving}
            >
              {t("options_useBrowserDownloads")}
            </Button>
          )}
        </div>

        {!fsaSupported && (
          <p className="text-xs text-muted-foreground">
            {t("options_fsaUnsupported")}
          </p>
        )}

        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
          <Label htmlFor="collision-policy">
            {t("options_conflictPolicy")}
          </Label>
          <Select
            value={downloads.conflictPolicy}
            onValueChange={(value: "overwrite" | "uniquify") =>
              onDownloadsChange({ conflictPolicy: value })
            }
          >
            <SelectTrigger id="collision-policy">
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
          <p className="text-xs text-muted-foreground">
            {t("options_conflictPolicyHelp")}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
