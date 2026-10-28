import type { CurrentSeriesContext } from "./tab-cache"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { getDefinition, isEnabled } from "@/src/site-integrations/catalog"
import { hasIntegrationHostPermission } from "@/src/site-integrations/host-permission-service"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import type { OffscreenDocumentAdmissionContext } from "@/src/runtime/resolve-series-data-offscreen"
import { COVER_PREVIEW_TIMEOUT_MS } from "@/src/runtime/cover-preview-contracts"

export interface CoverPreviewDependencies {
  ensureRuntimeReady: () => Promise<void>
  getCurrentSeriesContext: (
    tabId: number,
    windowId: number
  ) => Promise<CurrentSeriesContext | undefined>
  queueRepository: Pick<QueueRepository, "getTask">
  siteIntegrationEnablementService: Pick<
    SiteIntegrationEnablementService,
    "getAll"
  >
  rateLimitService: Pick<RateLimitService, "resolveEffectivePolicy">
  ensureNetworkReady: (integrationId: string) => Promise<void>
  admit: <T>(
    operation: (context: OffscreenDocumentAdmissionContext) => Promise<T>
  ) => Promise<T>
}

export type CoverPreviewHandlers = Pick<
  RuntimeMessageHandlerMap<"background">,
  "GET_COVER_PREVIEW" | "CANCEL_COVER_PREVIEW"
>

export function createBackgroundCoverPreviewMessageHandlers(
  deps: CoverPreviewDependencies
): CoverPreviewHandlers {
  const pending = new Map<
    string,
    { owner: string; controller: AbortController; dispatched: boolean }
  >()
  const failure = () => ({
    success: false as const,
    error: "Cover preview is unavailable",
  })
  const owner = (sender: chrome.runtime.MessageSender) =>
    sender.documentId ?? sender.url ?? ""

  async function resolveCover(
    source: RuntimeMessageRequest<"GET_COVER_PREVIEW">["payload"]["source"]
  ) {
    if (source.kind === "task") {
      const task = await deps.queueRepository.getTask(source.taskId)
      return task?.seriesCoverUrl
        ? {
            integrationId: task.siteIntegrationId,
            coverUrl: task.seriesCoverUrl,
          }
        : undefined
    }
    const current = await deps.getCurrentSeriesContext(
      source.tabId,
      source.windowId
    )
    if (
      !current ||
      current.windowId !== source.windowId ||
      current.revision !== source.seriesRevision ||
      current.context.mangaId !== source.seriesId
    )
      return undefined
    return current.context.metadata?.coverUrl
      ? {
          integrationId: current.context.siteIntegrationId,
          coverUrl: current.context.metadata.coverUrl,
        }
      : undefined
  }

  return {
    GET_COVER_PREVIEW: async (message, sender) => {
      const { requestId, source } = message.payload
      if (pending.has(requestId) || pending.size >= 16) return failure()
      const entry = {
        owner: owner(sender),
        controller: new AbortController(),
        dispatched: false,
      }
      pending.set(requestId, entry)
      const cancel = () => {
        if (entry.dispatched)
          void sendRuntimeMessage({
            target: "offscreen",
            type: "OFFSCREEN_CANCEL_COVER_PREVIEW",
            payload: { requestId },
          }).catch(() => undefined)
      }
      entry.controller.signal.addEventListener("abort", cancel, { once: true })
      let timeout: ReturnType<typeof setTimeout> | undefined
      const aborted = new Promise<never>((_, reject) => {
        entry.controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Cover preview canceled")),
          { once: true }
        )
        timeout = setTimeout(
          () => entry.controller.abort(),
          COVER_PREVIEW_TIMEOUT_MS
        )
      })
      const loadPreview = async () => {
        await deps.ensureRuntimeReady()
        entry.controller.signal.throwIfAborted()
        const cover = await resolveCover(source)
        if (
          !cover ||
          !getDefinition(cover.integrationId)?.shipped ||
          !isEnabled(
            cover.integrationId,
            await deps.siteIntegrationEnablementService.getAll()
          ) ||
          !(await hasIntegrationHostPermission(cover.integrationId))
        )
          return failure()
        await deps.ensureNetworkReady(cover.integrationId)
        const rateLimitSettings = {
          image: await deps.rateLimitService.resolveEffectivePolicy(
            cover.integrationId,
            "image"
          ),
          chapter: await deps.rateLimitService.resolveEffectivePolicy(
            cover.integrationId,
            "chapter"
          ),
        }
        entry.controller.signal.throwIfAborted()
        const admitted = await deps.admit((context) => {
          entry.controller.signal.throwIfAborted()
          const reservation = context.reserveTransientWork()
          entry.dispatched = true
          const response = sendRuntimeMessage({
            target: "offscreen",
            type: "OFFSCREEN_FETCH_COVER_PREVIEW",
            payload: { requestId, ...cover, rateLimitSettings },
          })
          return Promise.resolve({ response, reservation })
        })
        try {
          const response = await admitted.response
          entry.controller.signal.throwIfAborted()
          return response
        } finally {
          admitted.reservation.release()
        }
      }
      try {
        return await Promise.race([loadPreview(), aborted])
      } catch {
        return failure()
      } finally {
        clearTimeout(timeout)
        entry.controller.signal.removeEventListener("abort", cancel)
        pending.delete(requestId)
      }
    },
    CANCEL_COVER_PREVIEW: (message, sender) => {
      const entry = pending.get(message.payload.requestId)
      if (entry?.owner === owner(sender)) entry.controller.abort()
      return { success: true }
    },
  }
}
