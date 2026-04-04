import { z } from 'zod';
import { ArchiveFormatSchema, DownloadModeSchema, ImagePaddingDigitsSchema, LogLevelSchema } from '@/src/shared/download-contract';

// Validation schemas aligned with settings-types.ts structure

// Rate policy schema (used in both global and site overrides)
export const rateScopePolicySchema = z.object({
  concurrency: z.number().min(1).max(10),
  delayMs: z.number().min(0).max(10000)
});

// Download settings schema
export const downloadSettingsSchema = z.object({
  maxConcurrentChapters: z.number().min(1).max(10),
  downloadMode: DownloadModeSchema,
  customDirectoryEnabled: z.boolean(),
  customDirectoryHandleId: z.string().nullable(),
  pathTemplate: z.string().min(1, 'Path template is required'),
  defaultFormat: ArchiveFormatSchema,
  fileNameTemplate: z.string().optional(),
  maxConcurrentDownloads: z.number().min(1).max(10),
  overwriteExisting: z.boolean(),
  includeComicInfo: z.boolean(),
  includeCoverImage: z.boolean(),
  normalizeImageFilenames: z.boolean(),
  imagePaddingDigits: ImagePaddingDigitsSchema
});

// Advanced settings schema
export const advancedSettingsSchema = z.object({
  logLevel: LogLevelSchema,
  storageCleanupDays: z.number().min(1).max(365),
});

// Complete extension settings schema (matches ExtensionSettings from settings-types.ts)
export const extensionSettingsSchema = z.object({
  downloads: downloadSettingsSchema,
  globalPolicy: z.object({
    image: rateScopePolicySchema,
    chapter: rateScopePolicySchema
  }),
  globalRetries: z.object({
    image: z.number().min(0).max(10),
    chapter: z.number().min(0).max(10)
  }),
  notifications: z.boolean(),
  advanced: advancedSettingsSchema
});

// Site override record schema (matches SiteOverrideRecord from site-overrides-service.ts)
// All fields optional - presence indicates override
export const siteOverrideRecordSchema = z.object({
  outputFormat: ArchiveFormatSchema.optional(),
  pathTemplate: z.string().optional(),
  imagePolicy: rateScopePolicySchema.partial().optional(),
  chapterPolicy: rateScopePolicySchema.partial().optional(),
  retries: z.object({
    image: z.number().min(0).max(10).optional(),
    chapter: z.number().min(0).max(10).optional()
  }).optional()
});

// Full settings export/import schema (includes both settings and overrides)
export const settingsExportSchema = z.object({
  settings: extensionSettingsSchema,
  overrides: z.record(z.string(), siteOverrideRecordSchema).optional()
});

// Type exports
export type ExtensionSettingsForm = z.infer<typeof extensionSettingsSchema>;
export type SiteOverrideRecordForm = z.infer<typeof siteOverrideRecordSchema>;
export type SettingsExport = z.infer<typeof settingsExportSchema>;
