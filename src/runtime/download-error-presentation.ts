import {
  normalizeDownloadErrorCategory,
  type DownloadErrorCategory,
} from "@/src/shared/download-contract"
import { t } from "@/src/runtime/i18n"

const DOWNLOAD_ERROR_MESSAGE_KEYS: Record<DownloadErrorCategory, string> = {
  network_unavailable: "downloadError_networkUnavailable",
  provider_rate_limited: "downloadError_providerRateLimited",
  provider_changed: "downloadError_providerChanged",
  chapter_unavailable: "downloadError_chapterUnavailable",
  folder_permission_required: "downloadError_folderPermissionRequired",
  folder_unavailable: "downloadError_folderUnavailable",
  folder_write_failed: "downloadError_folderWriteFailed",
  disk_full: "downloadError_diskFull",
  browser_download_interrupted: "downloadError_browserDownloadInterrupted",
  archive_creation_failed: "downloadError_archiveCreationFailed",
  unknown: "downloadError_unknown",
}

/**
 * Convert a structured internal failure category to safe user-facing copy.
 * Raw provider, URL, browser, and exception strings must remain diagnostics.
 */
export function getDownloadErrorMessage(category: unknown): string {
  const normalized = normalizeDownloadErrorCategory(category) ?? "unknown"
  return t(DOWNLOAD_ERROR_MESSAGE_KEYS[normalized])
}
