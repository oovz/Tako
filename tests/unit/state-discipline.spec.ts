import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendStateAction } from '@/src/runtime/state-actions'
import { processStateAction } from '@/entrypoints/background/state-action-router'
import { StateAction } from '@/src/types/state-actions'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { StateActionMessage } from '@/src/types/state-action-message'

const mocks = vi.hoisted(() => ({
  runtimeSendMessage: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  handleInitializeTab: vi.fn(),
  handleClearTabState: vi.fn(),
  handleRemoveDownloadTask: vi.fn(),
  handleCancelDownloadTask: vi.fn(),
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: mocks.loggerDebug,
  },
}))

vi.mock('@/entrypoints/background/action-handlers/tab-state-handlers', () => ({
  handleInitializeTab: mocks.handleInitializeTab,
  handleClearTabState: mocks.handleClearTabState,
}))

vi.mock('@/entrypoints/background/action-handlers/download-task-handlers', () => ({
  handleRemoveDownloadTask: mocks.handleRemoveDownloadTask,
  handleCancelDownloadTask: mocks.handleCancelDownloadTask,
}))

describe('State discipline runtime guards', () => {
  const stateManager = {} as CentralizedStateManager
  let tabsGetMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runtimeSendMessage.mockResolvedValue(undefined)
    mocks.handleInitializeTab.mockResolvedValue({ success: true })
    mocks.handleClearTabState.mockResolvedValue({ success: true })
    tabsGetMock = vi.fn()

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: mocks.runtimeSendMessage,
      },
      storage: {
        session: {
          set: vi.fn(async () => undefined),
        },
      },
      tabs: {
        get: tabsGetMock,
      },
    })
  })

  describe('sendStateAction', () => {
    it('does not expose removed UPDATE_CHAPTER_STATUS in the runtime enum', () => {
      expect('UPDATE_CHAPTER_STATUS' in StateAction).toBe(false)
    })

    it('sends flattened STATE_ACTION message with enum action and tab id', async () => {
      await sendStateAction(
        StateAction.CLEAR_TAB_STATE,
        undefined,
        42,
      )

      expect(mocks.runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'STATE_ACTION',
          action: StateAction.CLEAR_TAB_STATE,
          payload: undefined,
          tabId: 42,
          timestamp: expect.any(Number),
        }),
      )
    })

    it('rejects non-enum actions at runtime', async () => {
      await expect(
        sendStateAction('REMOVED_TAB_SCOPED_ACTION' as unknown as StateAction, undefined, 42),
      ).rejects.toThrow('sendStateAction: "action" must be a StateAction enum value')

      expect(mocks.runtimeSendMessage).not.toHaveBeenCalled()
    })

    it('rejects arbitrary numeric values that are not declared StateAction members', async () => {
      await expect(
        sendStateAction(999 as StateAction, undefined, 42),
      ).rejects.toThrow('sendStateAction: "action" must be a StateAction enum value')

      expect(mocks.runtimeSendMessage).not.toHaveBeenCalled()
    })

    it('treats Extension context invalidation as non-fatal', async () => {
      mocks.runtimeSendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'))

      await expect(sendStateAction(StateAction.CLEAR_TAB_STATE, undefined, 42)).resolves.toBeUndefined()
      expect(mocks.loggerDebug).toHaveBeenCalled()
    })
  })

  describe('processStateAction', () => {
    it('enforces tab id for tab-scoped actions', async () => {
      const message: StateActionMessage = {
        type: 'STATE_ACTION',
        action: StateAction.CLEAR_TAB_STATE,
      }

      const result = await processStateAction(stateManager, message)

      expect(result).toEqual({ success: false, error: 'Tab ID required for CLEAR_TAB_STATE' })
      expect(mocks.handleClearTabState).not.toHaveBeenCalled()
    })

    it('accepts tab id zero for tab-scoped actions', async () => {
      const message: StateActionMessage = {
        type: 'STATE_ACTION',
        action: StateAction.CLEAR_TAB_STATE,
        tabId: 0,
      }

      const result = await processStateAction(stateManager, message)

      expect(result).toEqual({ success: true })
      expect(mocks.handleClearTabState).toHaveBeenCalledWith(stateManager, 0)
    })

    it('uses sender.tab.id when message tabId is absent', async () => {
      const message: StateActionMessage = {
        type: 'STATE_ACTION',
        action: StateAction.CLEAR_TAB_STATE,
      }

      const result = await processStateAction(stateManager, message, {
        tab: { id: 55 } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender)

      expect(result).toEqual({ success: true })
      expect(mocks.handleClearTabState).toHaveBeenCalledWith(stateManager, 55)
    })

    it('ignores stale ready INITIALIZE_TAB actions when the target tab has already navigated to an unsupported URL', async () => {
      const message: StateActionMessage = {
        type: 'STATE_ACTION',
        action: StateAction.INITIALIZE_TAB,
        tabId: 77,
        payload: {
          context: 'ready',
          siteIntegrationId: 'mangadex',
          mangaId: 'stale-series',
          seriesTitle: 'Stale Series',
          chapters: [],
        },
      }

      tabsGetMock.mockResolvedValue({
        id: 77,
        url: 'https://example.com/',
      } as chrome.tabs.Tab)

      const result = await processStateAction(stateManager, message, {
        tab: { id: 88 } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender)

      expect(result).toEqual({ success: true, data: { skipped: true, reason: 'stale-target-url' } })
      expect(mocks.handleInitializeTab).not.toHaveBeenCalled()
    })

    it('rejects malformed INITIALIZE_TAB payloads before reaching the handler', async () => {
      const message: StateActionMessage = {
        type: 'STATE_ACTION',
        action: StateAction.INITIALIZE_TAB,
        tabId: 77,
        payload: {
          context: 'ready',
          siteIntegrationId: 'mangadex',
          mangaId: 'series-1',
          seriesTitle: 'Series 1',
          chapters: [
            {
              id: '',
              url: 'https://mangadex.org/chapter/1',
              title: 'Chapter 1',
            },
          ],
        } as unknown,
      }

      const result = await processStateAction(stateManager, message)

      expect(result).toEqual({ success: false, error: 'Invalid payload for INITIALIZE_TAB' })
      expect(mocks.handleInitializeTab).not.toHaveBeenCalled()
    })

    it('returns standardized unknown-action error for unsupported actions', async () => {
      const message: StateActionMessage = {
        type: 'STATE_ACTION',
        action: 999 as StateAction,
      }

      const result = await processStateAction(stateManager, message)

      expect(result).toEqual({ success: false, error: 'Unknown action' })
      expect(mocks.loggerWarn).toHaveBeenCalledWith('Unknown state action: 999')
    })
  })
})

