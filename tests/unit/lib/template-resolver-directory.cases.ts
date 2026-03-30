import { describe, expect, it } from 'vitest';
import { resolveDownloadDirectory } from '@/src/shared/template-resolver';
import type { TemplateContext } from '@/src/shared/template-resolver';
import { baseDirectoryContext, baseEdgeContext } from './template-resolver-test-setup';

export function registerTemplateResolverDirectoryCases(): void {
  describe('template-resolver', () => {
    describe('resolveDownloadDirectory', () => {
      it('resolves simple template with series title', () => {
        const result = resolveDownloadDirectory('<SERIES_TITLE>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('One Piece');
      });

      it('resolves template with multiple segments', () => {
        const result = resolveDownloadDirectory('<PUBLISHER>/<SERIES_TITLE>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('Weekly Shonen Jump/One Piece');
      });

      it('resolves template with chapter title', () => {
        const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('One Piece/Chapter 1001 - Big Moms Rage');
      });

      it('resolves template with volume title', () => {
        const result = resolveDownloadDirectory('<SERIES_TITLE>/<VOLUME_TITLE>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('One Piece/Volume 99');
      });

      it('resolves template with date macros (YYYY/MM/DD)', () => {
        const result = resolveDownloadDirectory('<YYYY>/<MM>/<DD>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('2024/03/15');
      });

      it('resolves template with chapter number (padded)', () => {
        const result = resolveDownloadDirectory('<SERIES_TITLE>/Ch<CHAPTER_NUMBER_PAD3>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('One Piece/Ch1001');
      });

      it('resolves template with 2-digit padding', () => {
        const ctx = { ...baseDirectoryContext, chapterNumber: 5 };
        const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD2>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('Ch05');
      });

      it('resolves template with 3-digit padding', () => {
        const ctx = { ...baseDirectoryContext, chapterNumber: 5 };
        const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD3>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('Ch005');
      });

      it('resolves template with volume number (padded)', () => {
        const ctx = { ...baseDirectoryContext, volumeNumber: 3 };
        const result = resolveDownloadDirectory('Vol<VOLUME_NUMBER_PAD2>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('Vol03');
      });

      it('resolves template with integration name', () => {
        const result = resolveDownloadDirectory('<INTEGRATION_NAME>/<SERIES_TITLE>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('mangadex.org/One Piece');
      });

      it('sanitizes unsafe characters in resolved path', () => {
        const ctx = { ...baseDirectoryContext, seriesTitle: 'Series: Title / With * Invalid' };
        const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).not.toContain(':');
        expect(result.resolvedPath).not.toContain('*');
        expect(result.resolvedPath).not.toContain('/');
      });

      it('removes empty segments after macro expansion', () => {
        const ctx = { ...baseDirectoryContext, publisher: undefined };
        const result = resolveDownloadDirectory('<PUBLISHER>/<SERIES_TITLE>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('One Piece');
        expect(result.resolvedPath).not.toContain('//');
      });

      it('treats extension-like suffix as directory name', () => {
        const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>.cbz', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toContain('cbz');
      });

      it('returns error when chapterTitle is missing', () => {
        const ctx = { ...baseDirectoryContext, chapterTitle: '' };
        const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
        expect(result.success).toBe(false);
        expect(result.error).toContain('chapterTitle required');
      });

      it('returns error when format is missing', () => {
        const ctx = { ...baseDirectoryContext, format: '' };
        const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
        expect(result.success).toBe(false);
        expect(result.error).toContain('format required');
      });

      it('returns error when template has invalid macro', () => {
        const result = resolveDownloadDirectory('<INVALID_MACRO>', baseDirectoryContext);
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      });

      it('returns error when resolved directory is empty', () => {
        const ctx = { ...baseDirectoryContext, publisher: undefined, seriesTitle: undefined };
        const result = resolveDownloadDirectory('<PUBLISHER>', ctx);
        expect(result.success).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('handles template with only static text', () => {
        const result = resolveDownloadDirectory('StaticFolder/Downloads', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('StaticFolder/Downloads');
      });

      it('handles empty template (falls back to empty check)', () => {
        const result = resolveDownloadDirectory('', baseDirectoryContext);
        expect(result.success).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('handles template with leading/trailing slashes', () => {
        const result = resolveDownloadDirectory('/<SERIES_TITLE>/', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('One Piece');
        expect(result.resolvedPath).not.toMatch(/^\/|\/$/);
      });

      it('handles template with multiple consecutive slashes', () => {
        const result = resolveDownloadDirectory('<SERIES_TITLE>///<CHAPTER_TITLE>', baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).not.toContain('//');
      });

      it('resolves complex multi-level template', () => {
        const template = '<YYYY>/<PUBLISHER>/<SERIES_TITLE>/Vol<VOLUME_NUMBER_PAD2>/<CHAPTER_TITLE>';
        const result = resolveDownloadDirectory(template, baseDirectoryContext);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('2024/Weekly Shonen Jump/One Piece/Vol99/Chapter 1001 - Big Moms Rage');
      });

      it('handles undefined optional fields gracefully', () => {
        const ctx: TemplateContext = {
          date: new Date('2024-03-15'),
          chapterTitle: 'Chapter 1',
          format: 'cbz',
        };
        const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
        expect(result.success).toBe(false);
      });

      it('handles missing chapter/volume numbers (no padding)', () => {
        const ctx = { ...baseDirectoryContext, chapterNumber: undefined, volumeNumber: undefined };
        const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('One Piece/Chapter 1001 - Big Moms Rage');
      });
    });

    describe('edge cases and boundary conditions', () => {
      it('handles very long series titles (path length limits)', () => {
        const longTitle = 'A'.repeat(200);
        const ctx = { ...baseEdgeContext, seriesTitle: longTitle };
        const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath!.length).toBeLessThan(250);
      });

      it('handles unicode characters in titles', () => {
        const ctx = { ...baseEdgeContext, seriesTitle: '進撃の巨人', chapterTitle: 'Chapter 1 🎌' };
        const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toContain('進撃の巨人');
      });

      it('handles special characters that need sanitization', () => {
        const ctx = { ...baseEdgeContext, chapterTitle: 'Ch:1 <Part> "2" | Final?' };
        const result = resolveDownloadDirectory('<CHAPTER_TITLE>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).not.toMatch(/[:"|?<>]/);
      });

      it('handles zero as chapter number', () => {
        const ctx = { ...baseEdgeContext, chapterNumber: 0 };
        const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD2>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('Ch00');
      });

      it('handles large chapter numbers', () => {
        const ctx = { ...baseEdgeContext, chapterNumber: 9999 };
        const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD3>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('Ch9999');
      });

      it('correctly extracts year, month, day from date using local timezone', () => {
        const date = new Date(2024, 2, 15, 10, 30, 0);
        const ctx = { ...baseEdgeContext, date };
        const result = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx);
        expect(result.success).toBe(true);
        expect(result.resolvedPath).toBe('2024-03-15');
      });

      it('handles year boundary correctly with local timezone', () => {
        const dateEndOfYear = new Date(2024, 11, 31, 23, 59, 59);
        const ctx1 = { ...baseEdgeContext, date: dateEndOfYear };
        const result1 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx1);
        expect(result1.success).toBe(true);
        expect(result1.resolvedPath).toBe('2024-12-31');

        const dateStartOfYear = new Date(2025, 0, 1, 0, 0, 0);
        const ctx2 = { ...baseEdgeContext, date: dateStartOfYear };
        const result2 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx2);
        expect(result2.success).toBe(true);
        expect(result2.resolvedPath).toBe('2025-01-01');
      });

      it('handles month boundary correctly with local timezone', () => {
        const dateEndOfMonth = new Date(2024, 0, 31, 23, 59, 59);
        const ctx1 = { ...baseEdgeContext, date: dateEndOfMonth };
        const result1 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx1);
        expect(result1.success).toBe(true);
        expect(result1.resolvedPath).toBe('2024-01-31');

        const dateStartOfMonth = new Date(2024, 1, 1, 0, 0, 0);
        const ctx2 = { ...baseEdgeContext, date: dateStartOfMonth };
        const result2 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx2);
        expect(result2.success).toBe(true);
        expect(result2.resolvedPath).toBe('2024-02-01');
      });

      it('handles template with only whitespace', () => {
        const result = resolveDownloadDirectory('   ', baseEdgeContext);
        expect(result.success).toBe(false);
        expect(result.error).toContain('empty');
      });
    });
  });
}
