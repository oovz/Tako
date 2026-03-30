import { describe, expect, it } from 'vitest';
import { previewTemplate, resolveFileName } from '@/src/shared/template-resolver';
import { baseFileContext } from './template-resolver-test-setup';

export function registerTemplateResolverFilenameAndPreviewCases(): void {
  describe('template-resolver', () => {
    describe('resolveFileName', () => {
      it('uses chapter title as default when template is empty', () => {
        const result = resolveFileName('', baseFileContext);
        expect(result).toBe('Chapter 1001 - Big Moms Rage');
      });

      it('uses chapter title as default when template is undefined', () => {
        const result = resolveFileName(undefined, baseFileContext);
        expect(result).toBe('Chapter 1001 - Big Moms Rage');
      });

      it('resolves template with chapter title macro', () => {
        const result = resolveFileName('<CHAPTER_TITLE>', baseFileContext);
        expect(result).toBe('Chapter 1001 - Big Moms Rage');
      });

      it('resolves template with series and chapter', () => {
        const result = resolveFileName('<SERIES_TITLE> - <CHAPTER_TITLE>', baseFileContext);
        expect(result).toBe('One Piece - Chapter 1001 - Big Moms Rage');
      });

      it('resolves template with chapter number', () => {
        const result = resolveFileName('Ch<CHAPTER_NUMBER_PAD3>', baseFileContext);
        expect(result).toBe('Ch1001');
      });

      it('sanitizes unsafe characters in filename', () => {
        const ctx = { ...baseFileContext, chapterTitle: 'Chapter: 1 / Part * 2' };
        const result = resolveFileName('<CHAPTER_TITLE>', ctx);
        expect(result).not.toContain(':');
        expect(result).not.toContain('/');
        expect(result).not.toContain('*');
      });

      it('falls back to chapter title on invalid macro', () => {
        const result = resolveFileName('<INVALID_MACRO>', baseFileContext);
        expect(result).toBe('Chapter 1001 - Big Moms Rage');
      });

      it('trims whitespace from resolved filename', () => {
        const result = resolveFileName('  <CHAPTER_TITLE>  ', baseFileContext);
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
  });
}
