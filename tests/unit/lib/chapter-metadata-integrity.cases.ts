import { describe, expect, it } from 'vitest';
import { composeChapterMetadata } from '@/src/shared/chapter-metadata';
import type { Book } from '@/src/types/book';
import type { ChapterInput } from '@/src/types/chapter';

export function registerChapterMetadataIntegrityCases(): void {
  describe('composeChapterMetadata', () => {
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

        expect(book.comicInfoBase).toEqual(originalBase);
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
}
