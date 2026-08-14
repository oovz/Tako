import type { RateScopePolicy } from "@/src/types/rate-policy"
import type {
  ArchiveFormat,
  ConflictPolicy,
  DownloadDestination,
  ImagePaddingDigits,
  LogLevel,
} from "@/src/shared/download-contract"
import type { MotionPreference } from "@/src/shared/motion-preference"
import type { UiLanguagePreference } from "@/src/shared/ui-language"

export interface RetryCounts {
  image: number
  chapter: number
}

export interface AdvancedSettings {
  logLevel: LogLevel
  storageCleanupDays: number
}

export interface DownloadSettings {
  destination: DownloadDestination
  customDirectoryHandleId: string | null
  pathTemplate: string
  defaultFormat: ArchiveFormat
  fileNameTemplate: string
  conflictPolicy: ConflictPolicy
  suppressSaveAsDialog: boolean
  includeComicInfo: boolean
  includeCoverImage: boolean
  normalizeImageFilenames: boolean
  imagePaddingDigits: ImagePaddingDigits
}

export interface ExtensionSettings {
  downloads: DownloadSettings
  globalPolicy: {
    image: RateScopePolicy
    chapter: RateScopePolicy
  }
  globalRetries: RetryCounts
  notifications: boolean
  motionPreference: MotionPreference
  uiLanguage: UiLanguagePreference
  advanced: AdvancedSettings
}
