import { z } from 'zod'

export const ArchiveFormatSchema = z.enum(['CBZ', 'ZIP', 'NO_ARCHIVE'])
export type ArchiveFormat = z.infer<typeof ArchiveFormatSchema>

export const DownloadTaskStatusSchema = z.enum(['QUEUED', 'DOWNLOADING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELED'])
export type DownloadTaskStatus = z.infer<typeof DownloadTaskStatusSchema>

export const DirectoryKindSchema = z.enum(['downloads', 'custom'])
export type DirectoryKind = z.infer<typeof DirectoryKindSchema>

export const SeveritySchema = z.enum(['warning', 'error'])
export type Severity = z.infer<typeof SeveritySchema>
