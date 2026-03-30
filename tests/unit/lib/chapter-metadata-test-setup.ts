import type { Book } from '@/src/types/book';
import type { ChapterInput } from '@/src/types/chapter';

export function createTestBook(overrides?: Partial<Book>): Book {
  return {
    siteId: 'test-site',
    seriesTitle: 'Test Manga',
    seriesId: 'test-site:test-manga',
    comicInfoBase: {},
    ...overrides,
  };
}

export function createTestChapterInput(overrides?: Partial<ChapterInput>): ChapterInput {
  return {
    id: 'ch-1',
    url: 'https://example.com/chapter/1',
    title: 'Chapter 1',
    ...overrides,
  };
}
