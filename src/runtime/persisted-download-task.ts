import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { ArchiveFormatSchema, DownloadErrorCategorySchema, DownloadTaskChapterStatusSchema, DownloadTaskStatusSchema, ImagePaddingDigitsSchema } from '@/src/shared/download-contract';
import { isRecord } from '@/src/shared/type-guards';
import { z } from 'zod';
import type { DownloadTaskState, TaskChapter } from '@/src/types/queue-state';

const PersistedTaskChapterStatusSchema = DownloadTaskChapterStatusSchema;
const PersistedTaskStatusSchema = DownloadTaskStatusSchema;
const PersistedTaskErrorCategorySchema = DownloadErrorCategorySchema;

const BooleanOptionalSchema = z.preprocess(
  (value) => typeof value === 'boolean' ? value : undefined,
  z.boolean().optional(),
);

const NonEmptyStringOptionalSchema = z.preprocess(
  (value) => typeof value === 'string' && value.length > 0 ? value : undefined,
  z.string().optional(),
);

const ArchiveFormatOptionalSchema = z.preprocess(
  (value) => ArchiveFormatSchema.safeParse(value).success ? value : undefined,
  ArchiveFormatSchema.optional(),
);

const ImagePaddingDigitsOptionalSchema = z.preprocess(
  (value) => ImagePaddingDigitsSchema.safeParse(value).success ? value : undefined,
  ImagePaddingDigitsSchema.optional(),
);

const UnknownRecordOptionalSchema = z.preprocess(
  (value) => isRecord(value) ? value : undefined,
  z.record(z.string(), z.unknown()).optional(),
);

const PersistedTaskChapterSchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  locked: z.boolean().optional(),
  index: z.number().optional(),
  language: z.string().optional(),
  chapterLabel: z.string().optional(),
  chapterNumber: z.number().optional(),
  volumeNumber: z.number().optional(),
  volumeLabel: z.string().optional(),
  status: z.unknown().optional(),
  errorMessage: z.string().optional(),
  totalImages: z.number().optional(),
  imagesFailed: z.number().optional(),
  lastUpdated: z.number().optional(),
});

const PersistedTaskSettingsSnapshotSchema = z.object({
  archiveFormat: ArchiveFormatOptionalSchema,
  overwriteExisting: BooleanOptionalSchema,
  pathTemplate: NonEmptyStringOptionalSchema,
  fileNameTemplate: NonEmptyStringOptionalSchema,
  includeComicInfo: BooleanOptionalSchema,
  includeCoverImage: BooleanOptionalSchema,
  rateLimitSettings: z.preprocess(
    (value) => isRecord(value) ? value : undefined,
    z.object({
      image: UnknownRecordOptionalSchema,
      chapter: UnknownRecordOptionalSchema,
    }).partial().optional(),
  ),
  siteSettings: UnknownRecordOptionalSchema,
  normalizeImageFilenames: BooleanOptionalSchema,
  imagePaddingDigits: ImagePaddingDigitsOptionalSchema,
  comicInfo: UnknownRecordOptionalSchema,
}).strip();

const PersistedTaskSchema = z.object({
  id: z.string().optional(),
  siteIntegrationId: z.string().optional(),
  siteId: z.string().optional(),
  mangaId: z.string().optional(),
  seriesId: z.string().optional(),
  seriesTitle: z.string().optional(),
  seriesCoverUrl: z.string().optional(),
  chapters: z.array(z.unknown()),
  status: z.unknown().optional(),
  errorMessage: z.string().optional(),
  errorCategory: z.unknown().optional(),
  created: z.number().optional(),
  started: z.number().optional(),
  completed: z.number().optional(),
  isRetried: z.boolean().optional(),
  isRetryTask: z.boolean().optional(),
  lastSuccessfulDownloadId: z.number().optional(),
  settingsSnapshot: z.unknown().optional(),
  taskSettingsSnapshot: z.unknown().optional(),
  seriesMetadata: z.unknown().optional(),
}).strip();

export function normalizePersistedDownloadTask(rawTask: unknown): DownloadTaskState | null {
  const parsedTask = PersistedTaskSchema.safeParse(rawTask);
  if (!parsedTask.success) {
    return null;
  }

  const task = parsedTask.data;

  const siteIntegrationId = typeof task.siteIntegrationId === 'string'
    ? task.siteIntegrationId
    : typeof task.siteId === 'string'
      ? task.siteId
      : null;
  const mangaId = typeof task.mangaId === 'string'
    ? task.mangaId
    : typeof task.seriesId === 'string'
      ? task.seriesId
      : null;
  const seriesTitle = typeof task.seriesTitle === 'string' ? task.seriesTitle : null;

  if (!siteIntegrationId || !mangaId || !seriesTitle) {
    return null;
  }

  const legacySeriesMetadata = UnknownRecordOptionalSchema.safeParse(task.seriesMetadata).data;

  const baseSnapshot = createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId, {
    comicInfo: legacySeriesMetadata as DownloadTaskState['settingsSnapshot']['comicInfo'],
  });

  const rawSnapshotSource = isRecord(task.settingsSnapshot)
    ? task.settingsSnapshot
    : isRecord(task.taskSettingsSnapshot)
      ? task.taskSettingsSnapshot
      : undefined;
  const rawSnapshot = rawSnapshotSource
    ? PersistedTaskSettingsSnapshotSchema.safeParse(rawSnapshotSource).data
    : undefined;

  const settingsSnapshot = rawSnapshot
    ? {
      ...baseSnapshot,
      archiveFormat: rawSnapshot.archiveFormat ?? baseSnapshot.archiveFormat,
      overwriteExisting: rawSnapshot.overwriteExisting ?? baseSnapshot.overwriteExisting,
      pathTemplate: rawSnapshot.pathTemplate ?? baseSnapshot.pathTemplate,
      fileNameTemplate: rawSnapshot.fileNameTemplate ?? baseSnapshot.fileNameTemplate,
      includeComicInfo: rawSnapshot.includeComicInfo ?? baseSnapshot.includeComicInfo,
      includeCoverImage: rawSnapshot.includeCoverImage ?? baseSnapshot.includeCoverImage,
      rateLimitSettings: {
        image: {
          ...baseSnapshot.rateLimitSettings.image,
          ...(rawSnapshot.rateLimitSettings?.image
            ? rawSnapshot.rateLimitSettings.image
            : {}),
        },
        chapter: {
          ...baseSnapshot.rateLimitSettings.chapter,
          ...(rawSnapshot.rateLimitSettings?.chapter
            ? rawSnapshot.rateLimitSettings.chapter
            : {}),
        },
      },
      siteSettings: rawSnapshot.siteSettings ?? baseSnapshot.siteSettings,
      normalizeImageFilenames: rawSnapshot.normalizeImageFilenames ?? baseSnapshot.normalizeImageFilenames,
      imagePaddingDigits: rawSnapshot.imagePaddingDigits ?? baseSnapshot.imagePaddingDigits,
      comicInfo: rawSnapshot.comicInfo
        ? rawSnapshot.comicInfo as DownloadTaskState['settingsSnapshot']['comicInfo']
        : baseSnapshot.comicInfo,
      siteIntegrationId,
    }
    : baseSnapshot;

  const chapters: TaskChapter[] = task.chapters.flatMap((rawChapter) => {
    const parsedChapter = PersistedTaskChapterSchema.safeParse(rawChapter);
    if (!parsedChapter.success) {
      return [];
    }

    const chapter = parsedChapter.data;
    const chapterStatus = PersistedTaskChapterStatusSchema.safeParse(chapter.status);

    return [{
      id: typeof chapter.id === 'string' ? chapter.id : typeof chapter.url === 'string' ? chapter.url : crypto.randomUUID(),
      url: typeof chapter.url === 'string' ? chapter.url : '',
      title: typeof chapter.title === 'string' ? chapter.title : 'Untitled chapter',
      locked: chapter.locked === true,
      index: typeof chapter.index === 'number' ? chapter.index : 0,
      language: chapter.language,
      chapterLabel: chapter.chapterLabel,
      chapterNumber: chapter.chapterNumber,
      volumeNumber: chapter.volumeNumber,
      volumeLabel: chapter.volumeLabel,
      status: chapterStatus.success ? chapterStatus.data : 'queued',
      errorMessage: chapter.errorMessage,
      totalImages: chapter.totalImages,
      imagesFailed: chapter.imagesFailed,
      lastUpdated: typeof chapter.lastUpdated === 'number' ? chapter.lastUpdated : Date.now(),
    }];
  });

  const status = PersistedTaskStatusSchema.safeParse(task.status);
  const normalizedStatus = status.success ? status.data : 'queued';
  const errorCategory = PersistedTaskErrorCategorySchema.safeParse(task.errorCategory);

  const lastSuccessfulDownloadId =
    normalizedStatus === 'queued' || normalizedStatus === 'downloading'
      ? undefined
      : typeof task.lastSuccessfulDownloadId === 'number'
        ? task.lastSuccessfulDownloadId
        : undefined;

  return {
    id: typeof task.id === 'string' ? task.id : crypto.randomUUID(),
    siteIntegrationId,
    mangaId,
    seriesTitle,
    seriesCoverUrl: typeof task.seriesCoverUrl === 'string' ? task.seriesCoverUrl : undefined,
    chapters,
    status: normalizedStatus,
    errorMessage: task.errorMessage,
    errorCategory: errorCategory.success ? errorCategory.data : undefined,
    created: typeof task.created === 'number' ? task.created : Date.now(),
    started: task.started,
    completed: task.completed,
    isRetried: task.isRetried === true,
    isRetryTask: task.isRetryTask === true,
    lastSuccessfulDownloadId,
    settingsSnapshot,
  };
}
