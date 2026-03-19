/**
 * @file template-resolver.test.ts
 * @description Unit tests for download path template resolution
 * Covers: macro expansion, edge cases, validation, sanitization, all template variables
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDownloadDirectory,
  resolveFileName,
  previewTemplate,
  hasUnresolvedMacros,
  extractMacrosFromTemplate,
  type TemplateContext,
} from '@/src/shared/template-resolver';

describe('template-resolver', () => {
  describe('resolveDownloadDirectory', () => {
    const baseContext: TemplateContext = {
      date: new Date('2024-03-15T10:30:00Z'),
      publisher: 'Weekly Shonen Jump',
      integrationName: 'mangadex.org',
      seriesTitle: 'One Piece',
      chapterTitle: 'Chapter 1001 - Big Moms Rage',
      volumeTitle: 'Volume 99',
      format: 'cbz',
      chapterNumber: 1001,
      volumeNumber: 99,
    };

    it('resolves simple template with series title', () => {
      const result = resolveDownloadDirectory('<SERIES_TITLE>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('One Piece');
    });

    it('resolves template with multiple segments', () => {
      const result = resolveDownloadDirectory('<PUBLISHER>/<SERIES_TITLE>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('Weekly Shonen Jump/One Piece');
    });

    it('resolves template with chapter title', () => {
      const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('One Piece/Chapter 1001 - Big Moms Rage');
    });

    it('resolves template with volume title', () => {
      const result = resolveDownloadDirectory('<SERIES_TITLE>/<VOLUME_TITLE>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('One Piece/Volume 99');
    });

    it('resolves template with date macros (YYYY/MM/DD)', () => {
      const result = resolveDownloadDirectory('<YYYY>/<MM>/<DD>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('2024/03/15');
    });

    it('resolves template with chapter number (padded)', () => {
      const result = resolveDownloadDirectory('<SERIES_TITLE>/Ch<CHAPTER_NUMBER_PAD3>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('One Piece/Ch1001');
    });

    it('resolves template with 2-digit padding', () => {
      const ctx = { ...baseContext, chapterNumber: 5 };
      const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD2>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('Ch05');
    });

    it('resolves template with 3-digit padding', () => {
      const ctx = { ...baseContext, chapterNumber: 5 };
      const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD3>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('Ch005');
    });

    it('resolves template with volume number (padded)', () => {
      const ctx = { ...baseContext, volumeNumber: 3 };
      const result = resolveDownloadDirectory('Vol<VOLUME_NUMBER_PAD2>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('Vol03');
    });

    it('resolves template with integration name', () => {
      const result = resolveDownloadDirectory('<INTEGRATION_NAME>/<SERIES_TITLE>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('mangadex.org/One Piece');
    });

    it('sanitizes unsafe characters in resolved path', () => {
      const ctx = { ...baseContext, seriesTitle: 'Series: Title / With * Invalid' };
      const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).not.toContain(':');
      expect(result.resolvedPath).not.toContain('*');
      expect(result.resolvedPath).not.toContain('/');
    });

    it('removes empty segments after macro expansion', () => {
      const ctx = { ...baseContext, publisher: undefined };
      const result = resolveDownloadDirectory('<PUBLISHER>/<SERIES_TITLE>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('One Piece');
      expect(result.resolvedPath).not.toContain('//');
    });

    it('treats extension-like suffix as directory name', () => {
      const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>.cbz', baseContext);
      expect(result.success).toBe(true);
      // .cbz becomes part of the directory name
      expect(result.resolvedPath).toContain('cbz');
    });

    it('returns error when chapterTitle is missing', () => {
      const ctx = { ...baseContext, chapterTitle: '' };
      const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('chapterTitle required');
    });

    it('returns error when format is missing', () => {
      const ctx = { ...baseContext, format: '' };
      const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('format required');
    });

    it('returns error when template has invalid macro', () => {
      const result = resolveDownloadDirectory('<INVALID_MACRO>', baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns error when resolved directory is empty', () => {
      const ctx = { ...baseContext, publisher: undefined, seriesTitle: undefined };
      const result = resolveDownloadDirectory('<PUBLISHER>', ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('handles template with only static text', () => {
      const result = resolveDownloadDirectory('StaticFolder/Downloads', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('StaticFolder/Downloads');
    });

    it('handles empty template (falls back to empty check)', () => {
      const result = resolveDownloadDirectory('', baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('handles template with leading/trailing slashes', () => {
      const result = resolveDownloadDirectory('/<SERIES_TITLE>/', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('One Piece');
      expect(result.resolvedPath).not.toMatch(/^\/|\/$/);
    });

    it('handles template with multiple consecutive slashes', () => {
      const result = resolveDownloadDirectory('<SERIES_TITLE>///<CHAPTER_TITLE>', baseContext);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).not.toContain('//');
    });

    it('resolves complex multi-level template', () => {
      const template = '<YYYY>/<PUBLISHER>/<SERIES_TITLE>/Vol<VOLUME_NUMBER_PAD2>/<CHAPTER_TITLE>';
      const result = resolveDownloadDirectory(template, baseContext);
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
      expect(result.success).toBe(false); // Series title is undefined, empty result
    });

    it('handles missing chapter/volume numbers (no padding)', () => {
      const ctx = { ...baseContext, chapterNumber: undefined, volumeNumber: undefined };
      const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('One Piece/Chapter 1001 - Big Moms Rage');
    });
  });

  describe('resolveFileName', () => {
    const baseContext: TemplateContext = {
      date: new Date('2024-03-15'),
      seriesTitle: 'One Piece',
      chapterTitle: 'Chapter 1001 - Big Moms Rage',
      format: 'cbz',
      chapterNumber: 1001,
    };

    it('uses chapter title as default when template is empty', () => {
      const result = resolveFileName('', baseContext);
      expect(result).toBe('Chapter 1001 - Big Moms Rage');
    });

    it('uses chapter title as default when template is undefined', () => {
      const result = resolveFileName(undefined, baseContext);
      expect(result).toBe('Chapter 1001 - Big Moms Rage');
    });

    it('resolves template with chapter title macro', () => {
      const result = resolveFileName('<CHAPTER_TITLE>', baseContext);
      expect(result).toBe('Chapter 1001 - Big Moms Rage');
    });

    it('resolves template with series and chapter', () => {
      const result = resolveFileName('<SERIES_TITLE> - <CHAPTER_TITLE>', baseContext);
      expect(result).toBe('One Piece - Chapter 1001 - Big Moms Rage');
    });

    it('resolves template with chapter number', () => {
      const result = resolveFileName('Ch<CHAPTER_NUMBER_PAD3>', baseContext);
      expect(result).toBe('Ch1001');
    });

    it('sanitizes unsafe characters in filename', () => {
      const ctx = { ...baseContext, chapterTitle: 'Chapter: 1 / Part * 2' };
      const result = resolveFileName('<CHAPTER_TITLE>', ctx);
      expect(result).not.toContain(':');
      expect(result).not.toContain('/');
      expect(result).not.toContain('*');
    });

    it('falls back to chapter title on invalid macro', () => {
      const result = resolveFileName('<INVALID_MACRO>', baseContext);
      expect(result).toBe('Chapter 1001 - Big Moms Rage');
    });

    it('trims whitespace from resolved filename', () => {
      const result = resolveFileName('  <CHAPTER_TITLE>  ', baseContext);
      expect(result).toBe('Chapter 1001 - Big Moms Rage');
      expect(result).not.toMatch(/^\s|\s$/);
    });
  });

  describe('previewTemplate', () => {
    it('returns preview with sample context', () => {
      const preview = previewTemplate('<SERIES_TITLE>/<CHAPTER_TITLE>');
      expect(preview).toContain('Hunter x Hunter');
      expect(preview).toContain('Chapter 1');
      expect(preview).toContain('.cbz');
    });

    it('returns template itself if resolution fails', () => {
      const preview = previewTemplate('<INVALID_MACRO>');
      expect(preview).toBe('<INVALID_MACRO>');
    });

    it('generates complete file path preview', () => {
      const preview = previewTemplate('<PUBLISHER>/<SERIES_TITLE>');
      expect(preview).toMatch(/.*\/.*\.cbz$/);
    });
  });

  describe('hasUnresolvedMacros', () => {
    it('detects unresolved macros', () => {
      expect(hasUnresolvedMacros('path/with/<UNRESOLVED>/macro')).toBe(true);
    });

    it('returns false when no macros present', () => {
      expect(hasUnresolvedMacros('simple/path/without/macros')).toBe(false);
    });

    it('returns false when macros are resolved', () => {
      expect(hasUnresolvedMacros('One Piece/Chapter 1001')).toBe(false);
    });

    it('detects multiple unresolved macros', () => {
      expect(hasUnresolvedMacros('<SERIES>/<CHAPTER>/<PAGE>')).toBe(true);
    });
  });

  describe('extractMacrosFromTemplate', () => {
    it('extracts single macro', () => {
      const macros = extractMacrosFromTemplate('<SERIES_TITLE>');
      expect(macros).toEqual(['SERIES_TITLE']);
    });

    it('extracts multiple macros', () => {
      const macros = extractMacrosFromTemplate('<SERIES_TITLE>/<CHAPTER_TITLE>');
      expect(macros).toEqual(['SERIES_TITLE', 'CHAPTER_TITLE']);
    });

    it('returns empty array when no macros present', () => {
      const macros = extractMacrosFromTemplate('no/macros/here');
      expect(macros).toEqual([]);
    });

    it('extracts all date macros', () => {
      const macros = extractMacrosFromTemplate('<YYYY>/<MM>/<DD>');
      expect(macros).toEqual(['YYYY', 'MM', 'DD']);
    });

    it('extracts padded number macros', () => {
      const macros = extractMacrosFromTemplate('Ch<CHAPTER_NUMBER_PAD3>');
      expect(macros).toEqual(['CHAPTER_NUMBER_PAD3']);
    });

    it('handles duplicate macros', () => {
      const macros = extractMacrosFromTemplate('<SERIES_TITLE> - <SERIES_TITLE>');
      expect(macros).toEqual(['SERIES_TITLE', 'SERIES_TITLE']);
    });
  });

  describe('edge cases and boundary conditions', () => {
    const baseContext: TemplateContext = {
      date: new Date('2024-03-15'),
      chapterTitle: 'Chapter 1',
      format: 'cbz',
    };

    it('handles very long series titles (path length limits)', () => {
      const longTitle = 'A'.repeat(200);
      const ctx = { ...baseContext, seriesTitle: longTitle };
      const result = resolveDownloadDirectory('<SERIES_TITLE>', ctx);
      expect(result.success).toBe(true);
      // Should be truncated by sanitizer
      expect(result.resolvedPath!.length).toBeLessThan(250);
    });

    it('handles unicode characters in titles', () => {
      const ctx = { ...baseContext, seriesTitle: '進撃の巨人', chapterTitle: 'Chapter 1 🎌' };
      const result = resolveDownloadDirectory('<SERIES_TITLE>/<CHAPTER_TITLE>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toContain('進撃の巨人');
    });

    it('handles special characters that need sanitization', () => {
      const ctx = { ...baseContext, chapterTitle: 'Ch:1 <Part> "2" | Final?' };
      const result = resolveDownloadDirectory('<CHAPTER_TITLE>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).not.toMatch(/[:"|?<>]/);
    });

    it('handles zero as chapter number', () => {
      const ctx = { ...baseContext, chapterNumber: 0 };
      const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD2>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('Ch00');
    });

    it('handles large chapter numbers', () => {
      const ctx = { ...baseContext, chapterNumber: 9999 };
      const result = resolveDownloadDirectory('Ch<CHAPTER_NUMBER_PAD3>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('Ch9999'); // Padding doesn't truncate
    });

    it('correctly extracts year, month, day from date using local timezone', () => {
      // Create date in local time (not UTC) to match implementation behavior
      // Testing that getFullYear(), getMonth(), getDate() work correctly
      const date = new Date(2024, 2, 15, 10, 30, 0); // March 15, 2024, 10:30 AM local time
      const ctx = { ...baseContext, date };
      const result = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx);
      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('2024-03-15');
    });

    it('handles year boundary correctly with local timezone', () => {
      // Create dates in local time to test boundary behavior
      // Dec 31, 2024 at 11:59 PM local time
      const dateEndOfYear = new Date(2024, 11, 31, 23, 59, 59);
      const ctx1 = { ...baseContext, date: dateEndOfYear };
      const result1 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx1);
      expect(result1.success).toBe(true);
      expect(result1.resolvedPath).toBe('2024-12-31');

      // Jan 1, 2025 at 12:00 AM local time (one minute after)
      const dateStartOfYear = new Date(2025, 0, 1, 0, 0, 0);
      const ctx2 = { ...baseContext, date: dateStartOfYear };
      const result2 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx2);
      expect(result2.success).toBe(true);
      expect(result2.resolvedPath).toBe('2025-01-01');
    });

    it('handles month boundary correctly with local timezone', () => {
      // Jan 31, 2024 at 11:59 PM local time
      const dateEndOfMonth = new Date(2024, 0, 31, 23, 59, 59);
      const ctx1 = { ...baseContext, date: dateEndOfMonth };
      const result1 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx1);
      expect(result1.success).toBe(true);
      expect(result1.resolvedPath).toBe('2024-01-31');

      // Feb 1, 2024 at 12:00 AM local time
      const dateStartOfMonth = new Date(2024, 1, 1, 0, 0, 0);
      const ctx2 = { ...baseContext, date: dateStartOfMonth };
      const result2 = resolveDownloadDirectory('<YYYY>-<MM>-<DD>', ctx2);
      expect(result2.success).toBe(true);
      expect(result2.resolvedPath).toBe('2024-02-01');
    });

    it('handles template with only whitespace', () => {
      const result = resolveDownloadDirectory('   ', baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });
  });
});

