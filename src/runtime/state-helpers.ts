/**
 * State Helper Utilities
 * 
 * Provides helper functions for shared tab-state initialization.
 */

import type { ChapterState } from '@/src/types/tab-state';

export function initializeChapterStates(
  chapters: Omit<ChapterState, 'status' | 'lastUpdated'>[],
): ChapterState[] {
  const now = Date.now()

  return chapters.map((chapter) => ({
    ...chapter,
    status: 'queued',
    lastUpdated: now,
  }))
}
