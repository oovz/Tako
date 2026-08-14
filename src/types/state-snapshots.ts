import type {
  ArchiveFormat,
  ConflictPolicy,
  DownloadDestination,
  ImagePaddingDigits,
} from "@/src/shared/download-contract"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import type { SeriesMetadata } from "@/src/types/series-metadata"

export type SeriesMetadataSnapshot = Omit<SeriesMetadata, "title">

export interface RetrySettingsSnapshot {
  image: number
  chapter: number
}

export interface TaskSettingsSnapshot {
  archiveFormat: ArchiveFormat
  destination: DownloadDestination
  conflictPolicy: ConflictPolicy
  pathTemplate: string
  fileNameTemplate: string
  includeComicInfo: boolean
  includeCoverImage: boolean
  siteSettings: Record<string, unknown>
  rateLimitSettings: {
    image: RateScopePolicy
    chapter: RateScopePolicy
  }
  retrySettings: RetrySettingsSnapshot
  normalizeImageFilenames: boolean
  imagePaddingDigits: ImagePaddingDigits
  comicInfo?: SeriesMetadataSnapshot
  siteIntegrationId: string
}
