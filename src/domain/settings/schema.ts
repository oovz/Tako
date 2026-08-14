import { z } from "zod"

import {
  ArchiveFormatSchema,
  ConflictPolicySchema,
  DownloadDestinationSchema,
  ImagePaddingDigitsSchema,
  LogLevelSchema,
} from "@/src/shared/download-contract"
import { MOTION_PREFERENCES } from "@/src/shared/motion-preference"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"
import { UI_LANGUAGE_PREFERENCES } from "@/src/shared/ui-language"
import type { ExtensionSettings } from "./types"

export const SETTINGS_LIMITS = Object.freeze({
  MIN_CONCURRENCY: RATE_POLICY_LIMITS.MIN_CONCURRENCY,
  MAX_CONCURRENCY: RATE_POLICY_LIMITS.MAX_CONCURRENCY,
  MIN_DELAY_MS: RATE_POLICY_LIMITS.MIN_DELAY_MS,
  MAX_DELAY_MS: RATE_POLICY_LIMITS.MAX_DELAY_MS,
  MIN_RETRIES: 0,
  MAX_RETRIES: 10,
})

const RateScopePolicySchema = z.strictObject({
  concurrency: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.MIN_CONCURRENCY)
    .max(SETTINGS_LIMITS.MAX_CONCURRENCY),
  delayMs: z
    .number()
    .finite()
    .min(SETTINGS_LIMITS.MIN_DELAY_MS)
    .max(SETTINGS_LIMITS.MAX_DELAY_MS),
})

export const ExtensionSettingsSchema = z.strictObject({
  downloads: z.strictObject({
    destination: DownloadDestinationSchema,
    customDirectoryHandleId: z.string().min(1).nullable(),
    pathTemplate: z.string().min(1),
    defaultFormat: ArchiveFormatSchema,
    fileNameTemplate: z.string().min(1),
    conflictPolicy: ConflictPolicySchema,
    suppressSaveAsDialog: z.boolean(),
    includeComicInfo: z.boolean(),
    includeCoverImage: z.boolean(),
    normalizeImageFilenames: z.boolean(),
    imagePaddingDigits: ImagePaddingDigitsSchema,
  }),
  globalPolicy: z.strictObject({
    image: RateScopePolicySchema,
    chapter: RateScopePolicySchema.extend({ concurrency: z.literal(1) }),
  }),
  globalRetries: z.strictObject({
    image: z
      .number()
      .int()
      .min(SETTINGS_LIMITS.MIN_RETRIES)
      .max(SETTINGS_LIMITS.MAX_RETRIES),
    chapter: z
      .number()
      .int()
      .min(SETTINGS_LIMITS.MIN_RETRIES)
      .max(SETTINGS_LIMITS.MAX_RETRIES),
  }),
  notifications: z.boolean(),
  motionPreference: z.enum(MOTION_PREFERENCES),
  uiLanguage: z.enum(UI_LANGUAGE_PREFERENCES),
  advanced: z.strictObject({
    logLevel: LogLevelSchema,
    storageCleanupDays: z.number().finite().nonnegative(),
  }),
})

export type SettingsDocument = z.infer<typeof ExtensionSettingsSchema>

export class SettingsDocumentError extends Error {
  readonly issues: z.ZodIssue[]

  constructor(issues: z.ZodIssue[]) {
    super("Stored settings document is invalid")
    this.name = "SettingsDocumentError"
    this.issues = issues
  }
}

export function parseSettingsDocument(value: unknown): ExtensionSettings {
  const parsed = ExtensionSettingsSchema.safeParse(value)
  if (!parsed.success) {
    throw new SettingsDocumentError(parsed.error.issues)
  }
  return parsed.data
}

export function cloneSettings(settings: ExtensionSettings): ExtensionSettings {
  return structuredClone(settings)
}
