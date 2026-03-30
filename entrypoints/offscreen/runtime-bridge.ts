import logger from '@/src/runtime/logger'
import {
  OffscreenMessageSchema,
  type OffscreenMessage,
} from '@/src/runtime/message-schemas'
import type {
  ExtensionMessage,
  ExtensionMessageResponse,
} from '@/src/types/extension-messages'
import type {
  OffscreenDownloadChapterMessage,
  OffscreenDownloadChapterResponse,
} from '@/src/types/offscreen-messages'

interface OffscreenWorkerRuntime {
  initialize: () => Promise<void>
  processDownloadChapter: (
    payload: OffscreenDownloadChapterMessage['payload'],
  ) => Promise<{
    status: 'completed' | 'partial_success' | 'failed'
    errorMessage?: string
    errorCategory?: 'network' | 'download' | 'other'
    imagesFailed?: number
  }>
  cancelTask: (taskId: string) => boolean
  getActiveJobCount: () => number
}

interface PendingMessage {
  message: ExtensionMessage
  sendResponse: (response: ExtensionMessageResponse) => void
}

interface RegisterOffscreenRuntimeOptions {
  onInitialized?: () => void
  onInitializationError?: (errorMessage: string) => void
}

function parseOffscreenMessage<TType extends OffscreenMessage['type']>(
  message: ExtensionMessage,
  expectedType: TType,
): Extract<OffscreenMessage, { type: TType }> | null {
  const parsed = OffscreenMessageSchema.safeParse(message)
  if (!parsed.success || parsed.data.type !== expectedType) {
    return null
  }

  return parsed.data as Extract<OffscreenMessage, { type: TType }>
}

function processMessage(
  worker: OffscreenWorkerRuntime,
  message: ExtensionMessage,
  sendResponse?: (response?: ExtensionMessageResponse) => void,
  runtimeState?: { isInitialized: boolean; initializationError: string | null },
): boolean {
  if (message.type === 'OFFSCREEN_DOWNLOAD_CHAPTER') {
    const parsedMessage = parseOffscreenMessage(message, 'OFFSCREEN_DOWNLOAD_CHAPTER')
    if (!parsedMessage) {
      sendResponse?.({ success: false, error: 'Invalid OFFSCREEN_DOWNLOAD_CHAPTER payload' })
      return true
    }

    worker.processDownloadChapter(parsedMessage.payload as unknown as OffscreenDownloadChapterMessage['payload'])
      .then((outcome) => {
        const response: OffscreenDownloadChapterResponse = {
          success: true,
          status: outcome.status,
          errorMessage: outcome.errorMessage,
          errorCategory: outcome.errorCategory,
          imagesFailed: outcome.imagesFailed,
        }
        sendResponse?.(response)
      })
      .catch((error) => {
        logger.error('❌ OFFSCREEN_DOWNLOAD_CHAPTER failed:', error)
        sendResponse?.({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to process chapter',
        })
      })
    return true
  }

  if (message.type === 'OFFSCREEN_CONTROL') {
    const parsedMessage = parseOffscreenMessage(message, 'OFFSCREEN_CONTROL')
    if (!parsedMessage) {
      sendResponse?.({ success: false, error: 'Invalid OFFSCREEN_CONTROL payload' })
      return true
    }

    try {
      const { taskId, action } = parsedMessage.payload
      logger.debug('🎮 [OFFSCREEN] OFFSCREEN_CONTROL received:', { taskId, action })

      if (worker.cancelTask(taskId)) {
        logger.debug(`✅ [OFFSCREEN] Cancelled active chapter downloads for task ${taskId}`)
        sendResponse?.({ success: true })
        return true
      }

      sendResponse?.({ success: true })
    } catch (error) {
      logger.error('❌ [OFFSCREEN] OFFSCREEN_CONTROL failed:', error)
      sendResponse?.({
        success: false,
        error: error instanceof Error ? error.message : 'OFFSCREEN_CONTROL failed',
      })
    }
    return true
  }

  if (message.type === 'OFFSCREEN_STATUS') {
    const parsedMessage = parseOffscreenMessage(message, 'OFFSCREEN_STATUS')
    if (!parsedMessage) {
      sendResponse?.({ success: false, error: 'Invalid OFFSCREEN_STATUS payload' })
      return true
    }

    try {
      void parsedMessage
      sendResponse?.({
        success: true,
        isInitialized: runtimeState?.isInitialized === true,
        activeJobCount: worker.getActiveJobCount(),
      })
    } catch (error) {
      logger.error('❌ [OFFSCREEN] OFFSCREEN_STATUS failed:', error)
      sendResponse?.({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    return true
  }

  if (message.type === 'REVOKE_BLOB_URL') {
    const parsedMessage = parseOffscreenMessage(message, 'REVOKE_BLOB_URL')
    if (!parsedMessage) {
      sendResponse?.({ success: false, error: 'Invalid REVOKE_BLOB_URL payload' })
      return true
    }

    try {
      URL.revokeObjectURL(parsedMessage.payload.blobUrl)
      sendResponse?.({ success: true })
    } catch (error) {
      logger.debug('REVOKE_BLOB_URL failed (non-fatal):', error)
      sendResponse?.({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to revoke blob URL',
      })
    }
    return true
  }

  return false
}

export function registerOffscreenRuntime(
  worker: OffscreenWorkerRuntime,
  options: RegisterOffscreenRuntimeOptions = {},
): void {
  let isInitialized = false
  let initializationError: string | null = null
  const pendingMessages: PendingMessage[] = []

  const buildInitializationFailureResponse = (): ExtensionMessageResponse => ({
    success: false,
    error: initializationError ?? 'Offscreen worker initialization failed',
  })

  const flushPendingMessagesWithInitializationFailure = (): void => {
    if (pendingMessages.length === 0) {
      return
    }

    const response = buildInitializationFailureResponse()
    for (const { sendResponse } of pendingMessages.splice(0, pendingMessages.length)) {
      try {
        sendResponse(response)
      } catch (error) {
        logger.debug('Failed to respond to queued offscreen message after initialization failure:', error)
      }
    }
  }

  worker.initialize().then(() => {
    isInitialized = true
    options.onInitialized?.()
    logger.debug('🚀 Offscreen document ready for processing')

    if (pendingMessages.length > 0) {
      logger.debug(`Processing ${pendingMessages.length} queued offscreen messages`)
      for (const { message, sendResponse } of pendingMessages.splice(0, pendingMessages.length)) {
        logger.debug('📤 Processing queued message:', message.type)
        processMessage(
          worker,
          message,
          (response?: ExtensionMessageResponse) => sendResponse(response as ExtensionMessageResponse),
          { isInitialized, initializationError },
        )
      }
    }
  }).catch((error) => {
    initializationError = error instanceof Error ? error.message : 'Offscreen worker initialization failed'
    options.onInitializationError?.(initializationError)
    logger.error('❌ Failed to initialize offscreen worker:', error)
    flushPendingMessagesWithInitializationFailure()
  })

  chrome.runtime.onMessage.addListener((
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionMessageResponse) => void,
  ) => {
    if (initializationError) {
      sendResponse(buildInitializationFailureResponse())
      return true
    }

    if (!isInitialized) {
      logger.debug('📬 Queueing message until worker is initialized:', message.type)
      pendingMessages.push({ message, sendResponse })
      return true
    }

    return processMessage(
      worker,
      message,
      (response?: ExtensionMessageResponse) => sendResponse(response as ExtensionMessageResponse),
      { isInitialized, initializationError },
    )
  })
}

