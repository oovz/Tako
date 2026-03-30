import { describe, expect, it } from 'vitest';
import { extractMacrosFromTemplate, hasUnresolvedMacros } from '@/src/shared/template-resolver';

export function registerTemplateResolverMacroUtilityCases(): void {
  describe('template-resolver', () => {
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
  });
}
