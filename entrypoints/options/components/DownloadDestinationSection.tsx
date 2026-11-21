import type { DownloadDestinationSectionProps } from "./DownloadDestinationSection-contract"
import { tBrowser } from "@/src/runtime/browser-i18n"
import { t } from "@/src/runtime/i18n"
import { SettingsGroup } from "./primitives/SettingsGroup"
import { SettingsRow } from "./primitives/SettingsRow"
import { DownloadFolderDestination } from "./DownloadDestinationSection-folder"
import { DownloadDestinationOutput } from "./DownloadDestinationSection-output"

export type { DownloadDestinationSectionProps } from "./DownloadDestinationSection-contract"

export function DownloadDestinationSection(
  props: DownloadDestinationSectionProps
) {
  return (
    <SettingsGroup title={t("options_downloadDestination")}>
      {import.meta.env.FIREFOX ? (
        <SettingsRow
          title={tBrowser("destination_taskChrome")}
          description={t("options_firefoxDownloadFolder")}
        />
      ) : (
        <DownloadFolderDestination {...props} />
      )}
      <DownloadDestinationOutput
        downloads={props.downloads}
        isSaving={props.isSaving}
        onDownloadsChange={props.onDownloadsChange}
      />
    </SettingsGroup>
  )
}
