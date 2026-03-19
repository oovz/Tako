import { describe, expect, it, vi } from 'vitest'

import { resolveSourceTabId } from '@/entrypoints/background/sender-resolution'
import { enqueueStartDownloadTask } from '@/entrypoints/background/download-queue'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

describe('START_DOWNLOAD sender fallback integration', () => {
  it('resolves sourceTabId for sidepanel sender and preserves chapter language in enqueued task', async () => {
    const addDownloadTask = vi.fn(async (_task: unknown) => {})

    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [],
        settings: DEFAULT_SETTINGS,
        lastActivity: Date.now(),
      })),
      addDownloadTask,
    } as unknown as CentralizedStateManager

    const sender = {
      url: 'chrome-extension://test-extension-id/sidepanel.html',
    } as chrome.runtime.MessageSender

    const resolvedTabId = resolveSourceTabId(sender, 321)
    expect(resolvedTabId).toBe(321)

    const result = await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [
          {
            id: 'chapter-1',
            title: 'Chapter 1',
            url: 'https://mangadex.org/chapter/1',
            index: 1,
            chapterLabel: '1',
            language: 'ja',
          },
        ],
      },
      resolvedTabId!,
    )

    expect(result.success).toBe(true)

    const createdTask = addDownloadTask.mock.calls[0]?.[0] as {
      siteIntegrationId: string
      mangaId: string
      chapters: Array<{ language?: string }>
    }

    expect(createdTask.siteIntegrationId).toBe('mangadex')
    expect(createdTask.mangaId).toBe('series-1')
    expect(createdTask.chapters[0]?.language).toBe('ja')
  })

  it('prefers content-script sender tab over payload fallback and supports concurrent sidepanel senders', async () => {
    const addDownloadTask = vi.fn(async (_task: unknown) => {})

    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [],
        settings: DEFAULT_SETTINGS,
        lastActivity: Date.now(),
      })),
      addDownloadTask,
    } as unknown as CentralizedStateManager

    const contentScriptSender = {
      tab: { id: 777 },
      url: 'https://mangadex.org/title/series-1',
    } as chrome.runtime.MessageSender

    const sidePanelSenderA = {
      url: 'chrome-extension://test-extension-id/sidepanel.html',
    } as chrome.runtime.MessageSender

    const sidePanelSenderB = {
      url: 'chrome-extension://test-extension-id/sidepanel.html',
    } as chrome.runtime.MessageSender

    const resolvedContentTabId = resolveSourceTabId(contentScriptSender, 1000)
    const resolvedSidePanelTabIdA = resolveSourceTabId(sidePanelSenderA, 401)
    const resolvedSidePanelTabIdB = resolveSourceTabId(sidePanelSenderB, 402)

    expect(resolvedContentTabId).toBe(777)
    expect(resolvedSidePanelTabIdA).toBe(401)
    expect(resolvedSidePanelTabIdB).toBe(402)

    await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-content',
        seriesTitle: 'Series Content Script',
        chapters: [{ id: 'c1', title: 'Chapter 1', url: 'https://mangadex.org/chapter/c1', index: 1 }],
      },
      resolvedContentTabId!,
    )

    await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-a',
        seriesTitle: 'Series A',
        chapters: [{ id: 'a1', title: 'Chapter A1', url: 'https://mangadex.org/chapter/a1', index: 1 }],
      },
      resolvedSidePanelTabIdA!,
    )

    await enqueueStartDownloadTask(
      stateManager,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-b',
        seriesTitle: 'Series B',
        chapters: [{ id: 'b1', title: 'Chapter B1', url: 'https://mangadex.org/chapter/b1', index: 1 }],
      },
      resolvedSidePanelTabIdB!,
    )

    const createdTasks = addDownloadTask.mock.calls.map((call) => call[0] as { mangaId: string; siteIntegrationId: string })
    expect(createdTasks).toHaveLength(3)
    expect(createdTasks.map((task) => task.siteIntegrationId)).toEqual(['mangadex', 'mangadex', 'mangadex'])
    expect(createdTasks.map((task) => task.mangaId)).toEqual(['series-content', 'series-a', 'series-b'])
  })

  it('returns undefined when sender has no tab and no payload fallback', () => {
    const sender = {
      url: 'chrome-extension://test-extension-id/sidepanel.html',
    } as chrome.runtime.MessageSender

    const resolvedTabId = resolveSourceTabId(sender)
    expect(resolvedTabId).toBeUndefined()
  })
})

