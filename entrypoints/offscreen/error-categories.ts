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

const fsaNameCategories = new Map<string, FsaWriteErrorCategory>([
  ["quotaexceedederror", "disk_full"],
  ["diskfullerror", "disk_full"],
  ["notallowederror", "folder_permission_required"],
  ["permissionexpirederror", "folder_permission_required"],
  ["notfounderror", "folder_unavailable"],
  ["directorynotfounderror", "folder_unavailable"],
])

function includesAny(message: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => message.includes(phrase))
}

export function classifyFsaWriteErrorCategory(
  error: unknown
): FsaWriteErrorCategory {
  const category = fsaNameCategories.get(readErrorName(error))
  if (
    category === "disk_full" ||
    includesAny(readErrorMessage(error), [
      "disk full",
      "no space",
      "file_no_space",
    ])
  ) {
    return "disk_full"
  }
  return category ?? "folder_write_failed"
}

const fsaWriteErrorMessages: Record<FsaWriteErrorCategory, string> = {
  folder_permission_required: "Access to the selected folder is required.",
  folder_unavailable: "The selected folder is no longer available.",
  disk_full: "There is not enough disk space in the selected folder.",
  folder_write_failed: "Tako could not write to the selected folder.",
}

function getFsaWriteErrorMessage(category: FsaWriteErrorCategory): string {
  return fsaWriteErrorMessages[category]
}

export class FsaWriteError extends Error {
  readonly category: FsaWriteErrorCategory

  constructor(category: FsaWriteErrorCategory, cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : getFsaWriteErrorMessage(category),
      { cause }
    )
    this.name = "FsaWriteError"
    this.category = category
  }
}

export function toFsaWriteError(error: unknown): FsaWriteError {
  return error instanceof FsaWriteError
    ? error
    : new FsaWriteError(classifyFsaWriteErrorCategory(error), error)
}

function readExplicitCategory(error: unknown): ErrorCategory | undefined {
  if (error && typeof error === "object" && "category" in error) {
    return normalizeDownloadErrorCategory(error.category)
  }
  return undefined
}

function classifyContentError(message: string): ErrorCategory | undefined {
  const rules: ReadonlyArray<readonly [ErrorCategory, readonly string[]]> = [
    ["archive_creation_failed", ["archive creation failed", "zip worker"]],
    [
      "chapter_unavailable",
      ["no images found", "http 404", "chapter unavailable"],
    ],
    [
      "provider_changed",
      ["schema", "extract", "page structure", "provider changed"],
    ],
  ]
  for (const [category, phrases] of rules) {
    if (includesAny(message, phrases)) return category
  }
  return undefined
}

function classifyFolderError(
  name: string,
  message: string
): ErrorCategory | undefined {
  if (
    name === "notallowederror" ||
    (message.includes("permission") && message.includes("folder"))
  ) {
    return "folder_permission_required"
  }
  if (
    name === "notfounderror" ||
    message.includes("folder is missing") ||
    (message.includes("folder") &&
      includesAny(message, ["not configured", "unavailable"]))
  ) {
    return "folder_unavailable"
  }
  return undefined
}

function classifyNetworkError(message: string): ErrorCategory {
  return includesAny(message, [
    "timeout",
    "network",
    "dns",
    "unreachable",
    "offline",
    "econn",
    "enet",
    "fetch",
  ])
    ? "network_unavailable"
    : "unknown"
}

export function classifyOffscreenErrorCategory(error: unknown): ErrorCategory {
  const explicitCategory = readExplicitCategory(error)
  if (explicitCategory) return explicitCategory
  if (error instanceof FsaWriteError) return error.category

  const message = readErrorMessage(error)
  const name = readErrorName(error)
  if (includesAny(message, ["429", "rate limit"])) {
    return "provider_rate_limited"
  }
  if (
    name === "quotaexceedederror" ||
    includesAny(message, [
      "disk full",
      "no space",
      "quotaexceeded",
      "file_no_space",
    ])
  ) {
    return "disk_full"
  }
  return (
    classifyContentError(message) ??
    classifyFolderError(name, message) ??
    classifyNetworkError(message)
  )
}
