import { z } from "zod"

import { SETTINGS_LIMITS } from "@/src/domain/settings/schema"
import { ArchiveFormatSchema } from "@/src/shared/download-contract"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"
import type { StorageValue } from "@/src/shared/type-guards"

export type SiteOverrideRecord = {
  outputFormat?: "cbz" | "zip" | "none"
  pathTemplate?: string
  imagePolicy?: { concurrency?: number; delayMs?: number }
  chapterPolicy?: { delayMs?: number }
  retries?: { image?: number; chapter?: number }
}

export type SiteOverridesMap = Record<string, SiteOverrideRecord>

const RatePolicySchema = z.strictObject({
  concurrency: z
    .number()
    .int()
    .min(RATE_POLICY_LIMITS.MIN_CONCURRENCY)
    .max(RATE_POLICY_LIMITS.MAX_CONCURRENCY)
    .optional(),
  delayMs: z
    .number()
    .int()
    .min(RATE_POLICY_LIMITS.MIN_DELAY_MS)
    .max(RATE_POLICY_LIMITS.MAX_DELAY_MS)
    .optional(),
})

const ChapterPolicySchema = z.strictObject({
  delayMs: z
    .number()
    .int()
    .min(RATE_POLICY_LIMITS.MIN_DELAY_MS)
    .max(RATE_POLICY_LIMITS.MAX_DELAY_MS)
    .optional(),
})

const RetryOverridesSchema = z.strictObject({
  image: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.MIN_RETRIES)
    .max(SETTINGS_LIMITS.MAX_RETRIES)
    .optional(),
  chapter: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.MIN_RETRIES)
    .max(SETTINGS_LIMITS.MAX_RETRIES)
    .optional(),
})

export const SiteOverrideRecordSchema = z.strictObject({
  outputFormat: ArchiveFormatSchema.optional(),
  pathTemplate: z.string().optional(),
  imagePolicy: RatePolicySchema.optional(),
  chapterPolicy: ChapterPolicySchema.optional(),
  retries: RetryOverridesSchema.optional(),
})

export const SiteOverridesMapSchema = z.record(
  z.string(),
  SiteOverrideRecordSchema
)

export function normalizeSiteOverridesMap(raw: unknown): SiteOverridesMap {
  return raw === undefined ? {} : SiteOverridesMapSchema.parse(raw)
}

export type SiteIntegrationEnablementMap = Record<string, boolean>

export const SiteIntegrationEnablementMapSchema = z.record(
  z.string(),
  z.boolean()
)

export function normalizeEnablementMap(
  value: unknown
): SiteIntegrationEnablementMap {
  return value === undefined
    ? {}
    : SiteIntegrationEnablementMapSchema.parse(value)
}

export type SiteIntegrationSettingValue = StorageValue

export type SiteIntegrationSettingsMap = Record<
  string,
  Record<string, StorageValue>
>

const StorageValueSchema: z.ZodType<StorageValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(StorageValueSchema),
    z.record(z.string(), StorageValueSchema),
  ])
)

const SiteIntegrationSettingsRecordSchema = z.record(
  z.string(),
  StorageValueSchema
)

export const SiteIntegrationSettingsMapSchema = z.record(
  z.string(),
  SiteIntegrationSettingsRecordSchema
)
