import type { DownloadDestinationSectionProps } from "./DownloadDestinationSection-contract"
import { t } from "@/src/runtime/i18n"
import { SettingsGroup } from "./primitives/SettingsGroup"
import { DownloadFolderDestination } from "./DownloadDestinationSection-folder"
import { DownloadDestinationOutput } from "./DownloadDestinationSection-output"

export type { DownloadDestinationSectionProps } from "./DownloadDestinationSection-contract"

export function DownloadDestinationSection(
  props: DownloadDestinationSectionProps
) {
  return (
    <SettingsGroup
      title={t("options_downloadDestination")}
      description={t("options_conflictPolicyHelp")}
    >
      <DownloadFolderDestination {...props} />
      <DownloadDestinationOutput
        downloads={props.downloads}
        isSaving={props.isSaving}
        onDownloadsChange={props.onDownloadsChange}
      />
    </SettingsGroup>
  )
}
