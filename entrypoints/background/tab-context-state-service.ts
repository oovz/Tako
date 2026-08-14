import { tabContextCache } from "@/entrypoints/background/tab-cache"
import { initializeChapterStates } from "@/src/runtime/state-helpers"
import { isMangaPageState } from "@/src/runtime/tab-state-schemas"
import { resolveVolumeStates } from "@/src/runtime/state-shapes"
import { ResolvedTabContextSchema } from "@/src/runtime/resolved-tab-context-schema"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import type { MangaPageState, ProjectedTabContext } from "@/src/types/tab-state"
import type {
  ResolvedTabContext,
  ResolvedTabReadyContext,
} from "@/src/types/resolved-tab-context"

export interface TabContextStateProjectionOptions {
  requestId?: number
  windowId?: number
  supersedeInFlight?: boolean
  expectedUrl?: string
  ownerSignal?: AbortSignal
}

type ResolvedTabChapter = NonNullable<
  ResolvedTabReadyContext["chapters"]
>[number]

export interface TabContextStateProjection {
  commitTabContextMutation(
    tabId: number,
    options: TabContextStateProjectionOptions | undefined,
    mutation: () => Promise<ProjectedTabContext>
  ): Promise<boolean>
}

/**
 * Service-worker owner for tab and series context state.
 *
 * Session storage is the durable projection for this context. The cache owns
 * serialized publication and active-window revision fencing; this service
 * owns the strict state shape and resolved-series merge semantics.
 */
export class TabContextStateService {
  private initialized = false

  constructor(
    private readonly projection: TabContextStateProjection = tabContextCache
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    })
    this.initialized = true
  }

  async getTabState(tabId: number): Promise<MangaPageState | null> {
    const key = `tab_${tabId}`
    const result = await chrome.storage.session.get(key)
    const state = result[key]
    return isMangaPageState(state) ? state : null
  }

  async commitResolvedTabContext(
    payload: ResolvedTabContext,
    tabId: number,
    options?: TabContextStateProjectionOptions
  ): Promise<{ success: boolean; tabState?: unknown }> {
    const parsedPayload = ResolvedTabContextSchema.safeParse(payload)
    if (!parsedPayload.success) return { success: false }

    const typedPayload = parsedPayload.data
    const tabStateKey = `tab_${tabId}`
    const errorKey = `seriesContextError_${tabId}`

    if (typedPayload.context === "unsupported") {
      const applied = await this.projection.commitTabContextMutation(
        tabId,
        options,
        async () => {
          await chrome.storage.session.remove([tabStateKey, errorKey])
          return null
        }
      )
      return applied ? { success: true, tabState: null } : { success: true }
    }

    if (typedPayload.context === "error") {
      const applied = await this.projection.commitTabContextMutation(
        tabId,
        options,
        async () => {
          await chrome.storage.session.remove(tabStateKey)
          await chrome.storage.session.set({ [errorKey]: typedPayload.error })
          return { error: typedPayload.error }
        }
      )
      return applied
        ? { success: true, tabState: { error: typedPayload.error } }
        : { success: true }
    }

    const matchedIntegration = matchUrl(typedPayload.sourceUrl, {
      includeDisabled: true,
    })
    if (
      !matchedIntegration ||
      matchedIntegration.integrationId !== typedPayload.siteIntegrationId
    ) {
      return { success: false }
    }

    const chapters = typedPayload.chapters.map(
      (chapter: ResolvedTabChapter, index: number) => ({
        id: chapter.id,
        url: chapter.url,
        title: chapter.title,
        locked: chapter.locked === true,
        index: index + 1,
        chapterLabel: chapter.chapterLabel,
        language: chapter.language,
        chapterNumber:
          typeof chapter.chapterNumber === "number"
            ? chapter.chapterNumber
            : undefined,
        volumeId: chapter.volumeId,
        volumeNumber:
          typeof chapter.volumeNumber === "number"
            ? chapter.volumeNumber
            : undefined,
        volumeLabel: chapter.volumeLabel,
      })
    )

    const applied = await this.projection.commitTabContextMutation(
      tabId,
      options,
      async () => {
        const existingState = await this.getTabState(tabId)
        if (options?.ownerSignal?.aborted) return existingState

        if (
          existingState?.siteIntegrationId === typedPayload.siteIntegrationId &&
          existingState.mangaId === typedPayload.mangaId
        ) {
          const existingChapters = new Map(
            existingState.chapters.map((chapter) => [chapter.id, chapter])
          )
          const mergedState: MangaPageState = {
            ...existingState,
            sourceUrl: typedPayload.sourceUrl,
            seriesTitle: typedPayload.seriesTitle,
            chapters: chapters.map((chapter) => {
              const existing = existingChapters.get(chapter.id)
              return {
                ...chapter,
                status: existing?.status ?? "queued",
                errorMessage: existing?.errorMessage,
                totalImages: existing?.totalImages,
                imagesFailed: existing?.imagesFailed,
                lastUpdated: existing?.lastUpdated ?? Date.now(),
              }
            }),
            volumes: resolveVolumeStates(chapters, typedPayload.volumes),
            metadata: typedPayload.metadata ?? existingState.metadata,
            ...(typeof typedPayload.chaptersLoading === "boolean"
              ? { chaptersLoading: typedPayload.chaptersLoading }
              : { chaptersLoading: false }),
            ...(typedPayload.chapterListNotice
              ? { chapterListNotice: typedPayload.chapterListNotice }
              : { chapterListNotice: undefined }),
            lastUpdated: Date.now(),
          }
          await chrome.storage.session.remove(errorKey)
          await chrome.storage.session.set({ [tabStateKey]: mergedState })
          return mergedState
        }

        const initialState: MangaPageState = {
          sourceUrl: typedPayload.sourceUrl,
          siteIntegrationId: typedPayload.siteIntegrationId,
          mangaId: typedPayload.mangaId,
          seriesTitle: typedPayload.seriesTitle,
          chapters: initializeChapterStates(chapters),
          volumes: resolveVolumeStates(chapters, typedPayload.volumes),
          metadata: typedPayload.metadata,
          ...(typeof typedPayload.chaptersLoading === "boolean"
            ? { chaptersLoading: typedPayload.chaptersLoading }
            : {}),
          ...(typedPayload.chapterListNotice
            ? { chapterListNotice: typedPayload.chapterListNotice }
            : {}),
          lastUpdated: Date.now(),
        }
        await chrome.storage.session.remove(errorKey)
        await chrome.storage.session.set({ [tabStateKey]: initialState })
        return initialState
      }
    )

    if (!applied) return { success: true }
    return { success: true, tabState: await this.getTabState(tabId) }
  }

  async clearTabState(
    tabId: number,
    options?: TabContextStateProjectionOptions
  ): Promise<boolean> {
    return await this.projection.commitTabContextMutation(
      tabId,
      { ...options, supersedeInFlight: true },
      async () => {
        await chrome.storage.session.remove([
          `tab_${tabId}`,
          `seriesContextError_${tabId}`,
        ])
        return null
      }
    )
  }
}
