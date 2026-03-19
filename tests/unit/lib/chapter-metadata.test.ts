import { describe, it, expect } from 'vitest';
import { buildSeriesComicInfoBase, composeChapterMetadata } from '@/src/shared/chapter-metadata';
import type { Book } from '@/src/types/book';
import type { ChapterInput } from '@/src/types/chapter';
import type { SeriesMetadataSnapshot } from '@/src/types/state-snapshots';

// Test helper factories
function createTestBook(overrides?: Partial<Book>): Book {
  return {
    siteId: 'test-site',
    seriesTitle: 'Test Manga',
    seriesId: 'test-site:test-manga',
    comicInfoBase: {},
    ...overrides,
  };
}

function createTestChapterInput(overrides?: Partial<ChapterInput>): ChapterInput {
  return {
    id: 'ch-1',
    url: 'https://example.com/chapter/1',
    title: 'Chapter 1',
    ...overrides,
  };
}

describe('composeChapterMetadata', () => {
  describe('Basic composition', () => {
    it('creates Chapter from Book and ChapterInput', () => {
      const book = createTestBook({
        comicInfoBase: {
          Series: 'Test Manga',
          Writer: 'Test Author',
          Publisher: 'Test Publisher',
        },
      });

      const input = createTestChapterInput({
        chapterLabel: '1',
        chapterNumber: 1,
      });

      const result = composeChapterMetadata(book, input);

      expect(result.id).toBe('ch-1');
      expect(result.url).toBe('https://example.com/chapter/1');
      expect(result.title).toBe('Chapter 1');
      expect(result.chapterLabel).toBe('1');
      expect(result.chapterNumber).toBe(1);
    });

    it('includes ComicInfo metadata from book', () => {
      const book = createTestBook({
        comicInfoBase: {
          Series: 'Test Manga',
          Writer: 'Test Author',
          Publisher: 'Test Publisher',
          Genre: 'Action, Adventure',
        },
      });

      const input = createTestChapterInput();

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Series).toBe('Test Manga');
      expect(result.comicInfo.Writer).toBe('Test Author');
      expect(result.comicInfo.Publisher).toBe('Test Publisher');
      expect(result.comicInfo.Genre).toBe('Action, Adventure');
    });

    it('builds ComicInfo base from queue metadata snapshots without requiring title', () => {
      const metadata: SeriesMetadataSnapshot = {
        author: 'Test Author',
        publisher: 'Test Publisher',
        language: 'ja',
        readingDirection: 'rtl',
      };

      const result = buildSeriesComicInfoBase('Queued Series', metadata);

      expect(result.Series).toBe('Queued Series');
      expect(result.Writer).toBe('Test Author');
      expect(result.Publisher).toBe('Test Publisher');
      expect(result.LanguageISO).toBe('ja');
      expect(result.Manga).toBe('YesAndRightToLeft');
    });

    it('defaults Manga to Yes when the site does not provide an explicit reading direction', () => {
      const metadata: SeriesMetadataSnapshot = {
        language: 'ja',
      };

      const result = buildSeriesComicInfoBase('Queued Series', metadata);

      expect(result.LanguageISO).toBe('ja');
      expect(result.Manga).toBe('Yes');
    });
  });

  describe('Title handling', () => {
    it('uses chapter title when provided', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'The Beginning',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Title).toBe('The Beginning');
    });

    it('falls back to series title when chapter title missing', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Test Manga',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Title).toBe('Test Manga');
    });

    it('preserves base Title if present and no chapter title', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {
          Title: 'Original Title',
        },
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Original Title',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Title).toBe('Original Title');
    });
  });

  describe('Series field handling', () => {
    it('uses Series from comicInfoBase when present', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {
          Series: 'Official Series Name',
        },
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Series).toBe('Official Series Name');
    });

    it('falls back to seriesTitle when Series not in base', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Series).toBe('Test Manga');
    });
  });

  describe('Chapter number handling', () => {
    it('uses chapterLabel when provided', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
        chapterLabel: '1',
        chapterNumber: 1,
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('1');
      expect(result.chapterLabel).toBe('1');
    });

    it('converts numeric chapterNumber to string when chapterLabel not provided', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-5',
        url: 'https://example.com/chapter/5',
        title: 'Chapter 5',
        chapterNumber: 5,
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('5');
    });

    it('preserves decimal chapter numbers', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-5.5',
        url: 'https://example.com/chapter/5.5',
        title: 'Chapter 5.5',
        chapterNumber: 5.5,
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('5.5');
    });

    it('handles zero chapter number', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'prologue',
        url: 'https://example.com/chapter/0',
        title: 'Prologue',
        chapterNumber: 0,
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('0');
    });

    it('trims whitespace from chapterLabel', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
        chapterLabel: '  1  ',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('1');
    });

    it('handles special chapter numbers (bonus, extra)', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'bonus',
        url: 'https://example.com/chapter/bonus',
        title: 'Bonus Chapter',
        chapterLabel: 'Bonus',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('Bonus');
      expect(result.chapterLabel).toBe('Bonus');
    });
  });

  describe('Volume number handling', () => {
    it('includes volume number when provided', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
        volumeNumber: 1,
        volumeLabel: 'Volume 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Volume).toBe(1);
      expect(result.volumeNumber).toBe(1);
      expect(result.volumeLabel).toBe('Volume 1');
    });

    it('omits volume when not provided', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Volume).toBeUndefined();
      expect(result.volumeNumber).toBeUndefined();
    });

    it('handles volume 0', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-0',
        url: 'https://example.com/chapter/0',
        title: 'Prologue',
        volumeNumber: 0,
        volumeLabel: 'Prologue',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Volume).toBe(0);
      expect(result.volumeNumber).toBe(0);
    });
  });

  describe('Metadata preservation', () => {
    it('does not mutate book.comicInfoBase', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {
          Series: 'Original Series',
          Writer: 'Original Author',
        },
      };

      const originalBase = { ...book.comicInfoBase };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Modified Title',
      };

      const result = composeChapterMetadata(book, input);

      // Verify book base unchanged
      expect(book.comicInfoBase).toEqual(originalBase);
      
      // But result has modifications
      expect(result.comicInfo.Title).toBe('Modified Title');
    });

    it('preserves all base metadata fields', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {
          Series: 'Test Manga',
          Writer: 'John Doe',
          Publisher: 'Test Publisher',
          Genre: 'Action, Adventure',
          LanguageISO: 'en',
          Year: 2024,
          Manga: 'Yes',
        },
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Writer).toBe('John Doe');
      expect(result.comicInfo.Publisher).toBe('Test Publisher');
      expect(result.comicInfo.Genre).toBe('Action, Adventure');
      expect(result.comicInfo.LanguageISO).toBe('en');
      expect(result.comicInfo.Year).toBe(2024);
      expect(result.comicInfo.Manga).toBe('Yes');
    });

    it('propagates chapter language into composed chapter metadata', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {
          Series: 'Test Manga',
          LanguageISO: 'en',
        },
      };

      const input: ChapterInput = {
        id: 'ch-ja',
        url: 'https://example.com/chapter/ja',
        title: 'Japanese Chapter',
        language: 'ja',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.language).toBe('ja');
      expect(result.comicInfo.LanguageISO).toBe('ja');
    });
  });

  describe('Edge cases', () => {
    it('handles missing comicInfoBase', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Series).toBe('Test Manga');
      expect(result.comicInfo.Title).toBe('Chapter 1');
    });

    it('handles empty comicInfoBase', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Series).toBe('Test Manga');
      expect(result.comicInfo.Title).toBe('Chapter 1');
    });

    it('handles minimal ChapterInput', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: 'Minimal Chapter',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.id).toBe('ch-1');
      expect(result.url).toBe('https://example.com/chapter/1');
      expect(result.comicInfo.Series).toBe('Test Manga');
    });

    it('handles unicode in titles', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: '進撃の巨人',
        seriesId: 'shingeki',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: '第1話',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Series).toBe('進撃の巨人');
      expect(result.comicInfo.Title).toBe('第1話');
    });

    it('handles very long chapter titles', () => {
      const longTitle = 'A'.repeat(500);
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Test Manga',
        seriesId: 'test-manga',
        comicInfoBase: {},
      };

      const input: ChapterInput = {
        id: 'ch-1',
        url: 'https://example.com/chapter/1',
        title: longTitle,
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Title).toBe(longTitle);
      expect(result.title).toBe(longTitle);
    });
  });

  describe('Real-world scenarios', () => {
    it('composes metadata for standard numbered chapter', () => {
      const book: Book = {
        siteId: 'mangadex',
        seriesTitle: 'One Piece',
        seriesId: 'one-piece',
        comicInfoBase: {
          Series: 'One Piece',
          Writer: 'Eiichiro Oda',
          Publisher: 'Shueisha',
          Genre: 'Action, Adventure',
          Manga: 'Yes',
        },
      };

      const input: ChapterInput = {
        id: 'ch-1100',
        url: 'https://mangadex.org/chapter/1100',
        title: 'Thank You, Bonney',
        chapterLabel: '1100',
        chapterNumber: 1100,
      };

      const result = composeChapterMetadata(book, input);

      expect(result.id).toBe('ch-1100');
      expect(result.title).toBe('Thank You, Bonney');
      expect(result.chapterLabel).toBe('1100');
      expect(result.comicInfo.Series).toBe('One Piece');
      expect(result.comicInfo.Number).toBe('1100');
      expect(result.comicInfo.Writer).toBe('Eiichiro Oda');
    });

    it('composes metadata for volume-based chapter', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'Attack on Titan',
        seriesId: 'aot',
        comicInfoBase: {
          Series: 'Attack on Titan',
          Writer: 'Hajime Isayama',
        },
      };

      const input: ChapterInput = {
        id: 'vol-34-ch-139',
        url: 'https://example.com/chapter/139',
        title: 'Toward the Tree on That Hill',
        chapterLabel: '139',
        chapterNumber: 139,
        volumeNumber: 34,
        volumeLabel: 'Volume 34',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('139');
      expect(result.comicInfo.Volume).toBe(34);
      expect(result.volumeLabel).toBe('Volume 34');
    });

    it('composes metadata for special chapter', () => {
      const book: Book = {
        siteId: 'test-site',
        seriesTitle: 'My Hero Academia',
        seriesId: 'mha',
        comicInfoBase: {
          Series: 'My Hero Academia',
        },
      };

      const input: ChapterInput = {
        id: 'extra-1',
        url: 'https://example.com/chapter/extra-1',
        title: 'Hero Costume Special',
        chapterLabel: 'Extra 1',
      };

      const result = composeChapterMetadata(book, input);

      expect(result.comicInfo.Number).toBe('Extra 1');
      expect(result.chapterLabel).toBe('Extra 1');
    });
  });
});

