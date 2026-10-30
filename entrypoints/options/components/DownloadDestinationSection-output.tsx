import { FileDigit } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SettingsRow } from "./primitives/SettingsRow"
import { t } from "@/src/runtime/i18n"
import type { DownloadDestinationSectionProps } from "./DownloadDestinationSection-contract"

export function DownloadDestinationOutput({
  downloads,
  isSaving,
  onDownloadsChange,
}: Pick<
  DownloadDestinationSectionProps,
  "downloads" | "isSaving" | "onDownloadsChange"
>) {
  const isFsaActive = downloads.destination === "file-system-access"
  return (
    <>
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
    </>
  )
}
