import { captureRequestedOutputPath } from "@/src/runtime/task-output-path"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { getDefinition } from "@/src/site-integrations/catalog"
import type { SiteIntegrationDefinition } from "@/src/site-integrations/definition-types"
import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { pickChapterArchiveMetadata } from "@/src/shared/chapter-metadata"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { SiteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import type { SiteOverridesService } from "@/src/storage/site-overrides-service"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { ChapterState, MangaPageState } from "@/src/types/tab-state"

export interface StartDownloadSettingsInputs {
  settings: Awaited<ReturnType<SettingsRepository["getSettings"]>>
  siteSettings: Record<string, unknown>
  siteOverride: Awaited<ReturnType<SiteOverridesService["getAll"]>>[string]
  sitePolicyDefaults: SiteIntegrationDefinition["policyDefaults"] | undefined
}

export interface StartDownloadSettingsDependencies {
  settingsRepository: Pick<SettingsRepository, "reload">
  siteIntegrationSettingsService: Pick<
    SiteIntegrationSettingsService,
    "getForSite"
  >
  siteOverridesService: Pick<SiteOverridesService, "getAll">
}

export async function loadStartDownloadSettingsInputs(
  siteIntegrationId: string,
  deps: StartDownloadSettingsDependencies
): Promise<StartDownloadSettingsInputs> {
  const [settings, siteOverrides, siteSettings] = await Promise.all([
    deps.settingsRepository.reload(),
    deps.siteOverridesService.getAll(),
    deps.siteIntegrationSettingsService.getForSite(siteIntegrationId),
  ])

  return {
    settings,
    siteSettings,
    siteOverride: siteOverrides[siteIntegrationId],
    sitePolicyDefaults: getDefinition(siteIntegrationId)?.policyDefaults,
  }
}

export function buildStartDownloadTask(input: {
  context: MangaPageState
  selectedChapters: ChapterState[]
  settingsInputs: StartDownloadSettingsInputs
  taskId: string
  now: number
}): DownloadTaskState {
  const { context, selectedChapters, settingsInputs, taskId, now } = input
  const settingsSnapshot = createTaskSettingsSnapshot(
    settingsInputs.settings,
    context.siteIntegrationId,
    {
      siteSettings: settingsInputs.siteSettings,
      siteOverride: settingsInputs.siteOverride,
      sitePolicyDefaults: settingsInputs.sitePolicyDefaults,
      comicInfo: context.metadata,
    }
  )

  if (
    settingsSnapshot.destination.kind === "file-system-access" &&
    settingsSnapshot.destination.handleId === null
  )
    throw new Error("Select a download folder before creating a task")

  const chapters = selectedChapters.map((chapter) => ({
    ...pickChapterArchiveMetadata(chapter),
    id: chapter.id,
    url: chapter.url,
    title: sanitizeLabel(chapter.title),
    index: chapter.index,
    language: chapter.language,
    chapterLabel: chapter.chapterLabel
      ? sanitizeLabel(chapter.chapterLabel)
      : undefined,
    chapterNumber: chapter.chapterNumber,
    volumeId: chapter.volumeId ? sanitizeLabel(chapter.volumeId) : undefined,
    volumeNumber: chapter.volumeNumber,
    volumeLabel: chapter.volumeLabel
      ? sanitizeLabel(chapter.volumeLabel)
      : undefined,
    status: "queued",
    outputs: { requested: 0, committed: 0, failed: 0 },
    lastUpdated: now,
  }))

  const task = {
    ...(settingsSnapshot.allowChromeFallback
      ? { fsaFallbackEligible: true as const }
      : {}),
    id: taskId,
    siteIntegrationId: context.siteIntegrationId,
    mangaId: context.mangaId,
    seriesTitle: sanitizeLabel(context.seriesTitle),
    seriesCoverUrl: context.metadata?.coverUrl,
    chapters,
    status: "queued" as const,
    created: now,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    settingsSnapshot,
  }
  return {
    ...task,
    chapters: chapters.map((chapter) => ({
      ...chapter,
      status: "queued",
      requestedPath: captureRequestedOutputPath(task, chapter),
    })),
  }
}
