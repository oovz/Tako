import { describe, expect, it } from 'vitest';
import { generateComicInfo } from '@/src/shared/comicinfo-generator';
import type { ComicInfoV2 } from '@/src/types/comic-info';

export function registerComicInfoCoverCases(): void {
  describe('generateComicInfo - Cover Image Support', () => {
    describe('Pages section with cover marker', () => {
      it('marks cover page when hasCoverImage=true', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
          Title: 'Test Chapter',
        };

        const result = generateComicInfo(metadata, 10, '2.0', true);

        expect(result).toContain('<Pages>');
        expect(result).toContain('<Page Image="0" Type="FrontCover" />');
        expect(result).toContain('</Pages>');
      });

      it('includes all pages when cover is present', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
        };

        const result = generateComicInfo(metadata, 5, '2.0', true);

        expect(result).toContain('<Page Image="0" Type="FrontCover" />');
        expect(result).toContain('<Page Image="1" />');
        expect(result).toContain('<Page Image="2" />');
        expect(result).toContain('<Page Image="3" />');
        expect(result).toContain('<Page Image="4" />');
      });

      it('omits Pages section when hasCoverImage=false', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
        };

        const result = generateComicInfo(metadata, 10, '2.0', false);

        expect(result).not.toContain('<Pages>');
        expect(result).not.toContain('<Page Image="0" Type="FrontCover" />');
      });

      it('omits Pages section when hasCoverImage is default (false)', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
        };

        const result = generateComicInfo(metadata, 10);

        expect(result).not.toContain('<Pages>');
      });

      it('omits Pages section when PageCount is 0', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
        };

        const result = generateComicInfo(metadata, 0, '2.0', true);

        expect(result).not.toContain('<Pages>');
      });

      it('handles single page with cover', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
        };

        const result = generateComicInfo(metadata, 1, '2.0', true);

        expect(result).toContain('<Page Image="0" Type="FrontCover" />');
        expect(result).not.toContain('<Page Image="1" />');
      });
    });

    describe('Integration with PageCount', () => {
      it('PageCount includes cover image', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
        };

        const result = generateComicInfo(metadata, 10, '2.0', true);

        expect(result).toContain('<PageCount>10</PageCount>');
        expect(result).toContain('<Page Image="0" Type="FrontCover" />');
        expect(result).toContain('<Page Image="9" />');
      });

      it('PageCount matches when no cover', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test Series',
        };

        const result = generateComicInfo(metadata, 10, '2.0', false);

        expect(result).toContain('<PageCount>10</PageCount>');
        expect(result).not.toContain('<Pages>');
      });
    });

    describe('Real-world scenarios', () => {
      it('generates ComicInfo for manga chapter with cover', () => {
        const metadata: ComicInfoV2 = {
          Series: 'One Piece',
          Title: 'Romance Dawn',
          Number: '1',
          Writer: 'Oda Eiichiro',
          Manga: 'Yes',
          Publisher: 'Shueisha',
        };

        const result = generateComicInfo(metadata, 51, '2.0', true);

        expect(result).toContain('<Series>One Piece</Series>');
        expect(result).toContain('<Title>Romance Dawn</Title>');
        expect(result).toContain('<PageCount>51</PageCount>');
        expect(result).toContain('<Page Image="0" Type="FrontCover" />');
        expect(result).toContain('<Page Image="50" />');
      });

      it('handles chapter without cover (backward compatible)', () => {
        const metadata: ComicInfoV2 = {
          Series: 'One Piece',
          Title: 'Romance Dawn',
          Number: '1',
        };

        const result = generateComicInfo(metadata, 50);

        expect(result).toContain('<PageCount>50</PageCount>');
        expect(result).not.toContain('<Pages>');
        expect(result).not.toContain('FrontCover');
      });
    });

    describe('Comic reader compatibility', () => {
      it('uses standard ComicInfo v2.0 Pages format', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test',
        };

        const result = generateComicInfo(metadata, 3, '2.0', true);

        expect(result).toMatch(/<Page Image="\d+" \/>/);
        expect(result).toMatch(/<Page Image="0" Type="FrontCover" \/>/);
      });

      it('serializes explicit Pages metadata as Page elements instead of a JSON string', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test',
          Pages: [
            { Image: 0, Type: 'FrontCover' },
            { Image: 1 },
            { Image: 2, Bookmark: 'Chapter 1' },
          ],
        };

        const result = generateComicInfo(metadata, 3, '2.0', false);

        expect(result).toContain('<Pages>');
        expect(result).toContain('<Page Image="0" Type="FrontCover" />');
        expect(result).toContain('<Page Image="1" />');
        expect(result).toContain('<Page Image="2" Bookmark="Chapter 1" />');
        expect(result).not.toContain('&quot;Image&quot;');
      });

      it('maintains proper XML structure with cover', () => {
        const metadata: ComicInfoV2 = {
          Series: 'Test',
          Title: 'Chapter 1',
        };

        const result = generateComicInfo(metadata, 10, '2.0', true);

        const pagesIndex = result?.indexOf('<Pages>') ?? -1;
        const titleIndex = result?.indexOf('<Title>') ?? -1;

        expect(pagesIndex).toBeGreaterThan(titleIndex);
        expect(result).toContain('</Pages>');
      });
    });
  });
}
