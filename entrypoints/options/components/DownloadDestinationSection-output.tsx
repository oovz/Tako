import { SettingsChoices } from "./primitives/SettingsChoices"
import { Switch } from "@/components/ui/switch"
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
        control={
          <SettingsChoices
            label={t("options_conflictPolicy")}
            value={downloads.conflictPolicy}
            onChange={(conflictPolicy) => onDownloadsChange({ conflictPolicy })}
            choices={[
              { value: "uniquify", label: t("options_conflictUniquify") },
              { value: "overwrite", label: t("options_conflictOverwrite") },
            ]}
          />
        }
      />
    </>
  )
}
