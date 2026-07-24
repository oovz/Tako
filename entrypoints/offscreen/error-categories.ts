import type { ErrorCategory } from "./chapter-processing-types"
import { normalizeDownloadErrorCategory } from "@/src/shared/download-contract"

export type FsaWriteErrorCategory = Extract<
  ErrorCategory,
  | "folder_permission_required"
  | "folder_unavailable"
  | "folder_write_failed"
  | "disk_full"
>

function readErrorName(error: unknown): string {
  if (!error || typeof error !== "object" || !("name" in error)) return ""
  return typeof error.name === "string" ? error.name.toLowerCase() : ""
}

function readErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).toLowerCase()
}

export function classifyFsaWriteErrorCategory(
  error: unknown
): FsaWriteErrorCategory {
  const name = readErrorName(error)
  const message = readErrorMessage(error)

  if (
    name === "quotaexceedederror" ||
    name === "diskfullerror" ||
    message.includes("disk full") ||
    message.includes("no space") ||
    message.includes("file_no_space")
  ) {
    return "disk_full"
  }
  if (name === "notallowederror" || name === "permissionexpirederror") {
    return "folder_permission_required"
  }
  if (name === "notfounderror" || name === "directorynotfounderror") {
    return "folder_unavailable"
  }
  return "folder_write_failed"
}

function getFsaWriteErrorMessage(category: FsaWriteErrorCategory): string {
  switch (category) {
    case "folder_permission_required":
      return "Access to the selected folder is required."
    case "folder_unavailable":
      return "The selected folder is no longer available."
    case "disk_full":
      return "There is not enough disk space in the selected folder."
    case "folder_write_failed":
      return "Tako could not write to the selected folder."
  }
}

export class FsaWriteError extends Error {
  readonly category: FsaWriteErrorCategory

  constructor(category: FsaWriteErrorCategory, cause: unknown) {
    super(getFsaWriteErrorMessage(category), { cause })
    this.name = "FsaWriteError"
    this.category = category
  }
}

export function toFsaWriteError(error: unknown): FsaWriteError {
  return error instanceof FsaWriteError
    ? error
    : new FsaWriteError(classifyFsaWriteErrorCategory(error), error)
}

export function classifyOffscreenErrorCategory(error: unknown): ErrorCategory {
  if (error && typeof error === "object" && "category" in error) {
    const explicitCategory = normalizeDownloadErrorCategory(error.category)
    if (explicitCategory) return explicitCategory
  }
  if (error instanceof FsaWriteError) return error.category

  const msg = readErrorMessage(error)
  const name = readErrorName(error)

  if (msg.includes("429") || msg.includes("rate limit")) {
    return "provider_rate_limited"
  }

  if (
    msg.includes("disk full") ||
    msg.includes("no space") ||
    name === "quotaexceedederror" ||
    msg.includes("quotaexceeded") ||
    msg.includes("file_no_space")
  ) {
    return "disk_full"
  }

  if (msg.includes("archive creation failed") || msg.includes("zip worker")) {
    return "archive_creation_failed"
  }

  if (
    msg.includes("no images found") ||
    msg.includes("http 404") ||
    msg.includes("chapter unavailable")
  ) {
    return "chapter_unavailable"
  }

  if (
    msg.includes("schema") ||
    msg.includes("extract") ||
    msg.includes("page structure") ||
    msg.includes("provider changed")
  ) {
    return "provider_changed"
  }

  if (
    name === "notallowederror" ||
    (msg.includes("permission") && msg.includes("folder")) ||
    (msg.includes("permission denied") && msg.includes("folder"))
  ) {
    return "folder_permission_required"
  }

  if (
    name === "notfounderror" ||
    msg.includes("folder is unavailable") ||
    msg.includes("folder is not configured") ||
    msg.includes("folder is missing") ||
    (msg.includes("not configured") && msg.includes("folder")) ||
    (msg.includes("unavailable") && msg.includes("folder"))
  ) {
    return "folder_unavailable"
  }

  if (
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("dns") ||
    msg.includes("unreachable") ||
    msg.includes("offline") ||
    msg.includes("econn") ||
    msg.includes("enet") ||
    msg.includes("fetch") ||
    msg.includes("failed to fetch")
  ) {
    return "network_unavailable"
  }

  return "unknown"
}
