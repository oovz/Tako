import { t } from "@/src/runtime/i18n"

const FIREFOX_MESSAGE_KEYS = {
  destination_taskChrome: "destination_taskFirefox",
  downloadError_browserDownloadInterrupted:
    "downloadError_firefoxDownloadInterrupted",
  downloadError_browserOutputUnconfirmed:
    "downloadError_firefoxOutputUnconfirmed",
  options_uiLanguageDesc: "options_firefoxUiLanguageDesc",
  progressStage_sendingToChrome: "progressStage_sendingToFirefox",
  sidepanel_cancelProgressWarning: "sidepanel_firefoxCancelProgressWarning",
  sidepanel_cancelTaskNote: "sidepanel_firefoxCancelTaskNote",
  sidepanel_checkDownloads: "sidepanel_openDownloadsFolder",
  sidepanel_checkDownloadsFailed: "sidepanel_openDownloadsFolderFailed",
  sidepanel_chromeDownloads: "destination_taskFirefox",
  sidepanel_seriesHostPermissionRequired:
    "sidepanel_firefoxSeriesHostPermissionRequired",
} as const

export function tBrowser(
  key: keyof typeof FIREFOX_MESSAGE_KEYS,
  substitutions?: string | string[]
): string {
  return t(
    import.meta.env.FIREFOX ? FIREFOX_MESSAGE_KEYS[key] : key,
    substitutions
  )
}
