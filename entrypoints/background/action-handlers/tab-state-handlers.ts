/**
 * Tab State Action Handlers
 * 
 * Handlers for tab-specific state actions (initialization, UI).
 */

import { CentralizedStateManager } from '@/src/runtime/centralized-state';
import { InitializeTabPayloadSchema } from '@/src/runtime/state-action-schemas';
import { tabContextCache, type TabContextCacheValue } from '@/entrypoints/background/tab-cache';
import type { InitializeTabPayload, InitializeTabReadyPayload } from '@/src/types/state-action-tab-payloads';

function getTabStateStorageKey(tabId: number): string {
  return `tab_${tabId}`
}

function getTabErrorStorageKey(tabId: number): string {
  return `seriesContextError_${tabId}`
}

async function syncCachedProjection(tabId: number, value: TabContextCacheValue): Promise<void> {
  tabContextCache.setCachedContext(tabId, value)
  await tabContextCache.syncActiveTabContext()
}

type InitializeTabChapter = NonNullable<InitializeTabReadyPayload['chapters']>[number]

/**
 * Initialize tab state with series and chapter data
 * 
 * Manga Site Detection and Individual Chapter Selection
 * 
 * Called by content script after detecting a supported manga site and scraping
 * the series page. Creates initial tab state with chapter list.
 * 
 * @param stateManager - State manager instance
 * @param payload - Series metadata and chapter list
 * @param tabId - Tab ID (required) - identifies which tab to initialize
 * @returns Success with created tab state
 */
export async function handleInitializeTab(
  stateManager: CentralizedStateManager,
  payload: InitializeTabPayload,
  tabId: number
): Promise<{ success: boolean; tabState?: unknown }> {
  const tabStateStorageKey = getTabStateStorageKey(tabId)
  const tabErrorStorageKey = getTabErrorStorageKey(tabId)

  const parsedPayload = InitializeTabPayloadSchema.safeParse(payload)
  if (!parsedPayload.success) {
    await chrome.storage.session.remove(tabStateStorageKey)
    await chrome.storage.session.set({ [tabErrorStorageKey]: 'Invalid INITIALIZE_TAB payload' })
    await syncCachedProjection(tabId, { error: 'Invalid INITIALIZE_TAB payload' })
    return { success: false }
  }

  const typedPayload = parsedPayload.data

  if (typedPayload.context === 'unsupported') {
    await chrome.storage.session.remove([tabStateStorageKey, tabErrorStorageKey])
    await syncCachedProjection(tabId, null)
    return { success: true, tabState: null }
  }

  if (typedPayload.context === 'error') {
    await chrome.storage.session.remove(tabStateStorageKey)
    await chrome.storage.session.set({ [tabErrorStorageKey]: typedPayload.error })
    await syncCachedProjection(tabId, { error: typedPayload.error })
    return { success: true, tabState: { error: typedPayload.error } }
  }

  const siteId = typedPayload.siteIntegrationId
  const seriesId = typedPayload.mangaId
  const seriesTitle = typedPayload.seriesTitle
  const chapters = typedPayload.chapters
  const volumes = typedPayload.volumes
  const metadata = typedPayload.metadata

  const chaptersState = chapters.map((ch: InitializeTabChapter, idx: number) => ({
    id: ch.id,
    url: ch.url,
    title: ch.title,
    locked: ch.locked === true,
    index: idx + 1, // 1-based index from site integration extraction order
    chapterLabel: ch.chapterLabel,
    language: ch.language,
    chapterNumber: typeof ch.chapterNumber === 'number' ? ch.chapterNumber : undefined,
    volumeNumber: typeof ch.volumeNumber === 'number' ? ch.volumeNumber : undefined,
    volumeLabel: ch.volumeLabel
  })) || [];
  
  await stateManager.initializeTabState(
    tabId, 
    siteId, 
    seriesId, 
    seriesTitle, 
    chaptersState, 
    metadata,
    volumes,
  );
  
  const tabState = await stateManager.getTabState(tabId);
  await chrome.storage.session.remove(tabErrorStorageKey)
  await syncCachedProjection(tabId, tabState ?? null)
  return { success: true, tabState };
}

/**
 * Clear all state for a tab
 * 
 * Called when tab is closed or user navigates away from supported site.
 * Removes tab state from chrome.storage.session.
 * 
 * @param stateManager - State manager instance
 * @param tabId - Tab ID (required)
 * @returns Success confirmation
 */
export async function handleClearTabState(
  stateManager: CentralizedStateManager,
  tabId: number
): Promise<{ success: boolean }> {
  tabContextCache.setCachedContext(tabId, null)
  await stateManager.clearTabState(tabId);
  tabContextCache.deleteCachedContext(tabId)
  return { success: true };
}

