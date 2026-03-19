import { describe, it, expect } from 'vitest';
import { generateComicInfo } from '@/src/shared/comicinfo-generator';
import type { ComicInfoV2 } from '@/src/types/comic-info';

describe('ComicInfo Generator', () => {
    const basicMetadata: ComicInfoV2 = {
        Title: 'Test Chapter',
        Series: 'Test Series',
        Number: '1',
        Volume: 1,
        Writer: 'Test Author',
        Summary: 'A test summary'
    };

    it('should generate valid XML with basic metadata', () => {
        const xml = generateComicInfo(basicMetadata, 20);
        expect(xml).toContain('<Title>Test Chapter</Title>');
        expect(xml).toContain('<Series>Test Series</Series>');
        expect(xml).toContain('<Number>1</Number>');
        expect(xml).toContain('<Volume>1</Volume>');
        expect(xml).toContain('<Writer>Test Author</Writer>');
        expect(xml).toContain('<Summary>A test summary</Summary>');
        expect(xml).toContain('<PageCount>20</PageCount>');
        expect(xml).toContain('ComicInfo xmlns:xsi');
    });

    it('should include cover image page definition when hasCoverImage is true', () => {
        const xml = generateComicInfo(basicMetadata, 20, '2.0', true);
        expect(xml).toContain('<Pages>');
        expect(xml).toContain('<Page Image="0" Type="FrontCover" />');
        expect(xml).toContain('<Page Image="1" />');
        expect(xml).toContain('</Pages>');
    });

    it('should NOT include Pages section when hasCoverImage is false', () => {
        const xml = generateComicInfo(basicMetadata, 20, '2.0', false);
        expect(xml).not.toContain('<Pages>');
        expect(xml).not.toContain('<Page Image="0" Type="FrontCover" />');
    });

    it('should escape special characters in XML', () => {
        const specialMetadata: ComicInfoV2 = {
            Title: 'Test & < > " \'',
            Series: 'Series & More'
        };
        const xml = generateComicInfo(specialMetadata, 10);
        expect(xml).toContain('<Title>Test &amp; &lt; &gt; &quot; &apos;</Title>');
        expect(xml).toContain('<Series>Series &amp; More</Series>');
    });

    it('should filter out unsupported fields for v2.0', () => {
        const extendedMetadata = {
            ...basicMetadata,
            UnsupportedField: 'Should not be here'
        } as ComicInfoV2;

        const xml = generateComicInfo(extendedMetadata, 10);
        expect(xml).not.toContain('<UnsupportedField>');
    });

    it('should handle empty metadata gracefully', () => {
        const xml = generateComicInfo({}, 0);
        expect(xml).toContain('<ComicInfo');
        expect(xml).toContain('</ComicInfo>');
    });
});

