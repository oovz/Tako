import { describe, expect, it } from 'vitest';
import { validateDownloadPath } from '@/src/shared/download-path-validator';

export function registerValidateDownloadPathCases(): void {
  describe('validateDownloadPath', () => {
    describe('Empty path validation', () => {
      it('rejects empty string', () => {
        const result = validateDownloadPath('');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Download path cannot be empty');
      });

      it('rejects whitespace-only string', () => {
        const result = validateDownloadPath('   ');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Download path cannot be empty');
      });

      it('rejects tab and newline only', () => {
        const result = validateDownloadPath('\t\n');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Download path cannot be empty');
      });
    });

    describe('Invalid character detection', () => {
      it('rejects path with colon', () => {
        const result = validateDownloadPath('path:name');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
        expect(result.error).toContain(':');
      });

      it('rejects path with double quote', () => {
        const result = validateDownloadPath('path"name');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
        expect(result.error).toContain('"');
      });

      it('rejects path with pipe', () => {
        const result = validateDownloadPath('path|name');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
        expect(result.error).toContain('|');
      });

      it('rejects path with question mark', () => {
        const result = validateDownloadPath('path?name');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
        expect(result.error).toContain('?');
      });

      it('rejects path with asterisk', () => {
        const result = validateDownloadPath('path*name');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
        expect(result.error).toContain('*');
      });

      it('rejects path with multiple invalid characters', () => {
        const result = validateDownloadPath('path:name?with|invalid*chars"');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });
    });

    describe('Leading slash validation', () => {
      it('rejects path starting with forward slash', () => {
        const result = validateDownloadPath('/path/to/file');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Download path cannot start with a slash');
      });

      it('accepts path without leading slash', () => {
        const result = validateDownloadPath('path/to/file');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('rejects path with only leading slash', () => {
        const result = validateDownloadPath('/');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Download path cannot start with a slash');
      });
    });

    describe('Template bracket validation', () => {
      it('accepts balanced template brackets', () => {
        const result = validateDownloadPath('{series_title}/{chapter_number}');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('rejects unmatched opening bracket', () => {
        const result = validateDownloadPath('path/<template');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('unmatched template brackets');
      });

      it('rejects unmatched closing bracket', () => {
        const result = validateDownloadPath('path/template>');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('unmatched template brackets');
      });

      it('rejects multiple unmatched brackets', () => {
        const result = validateDownloadPath('path/<template1/<template2>');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('unmatched template brackets');
      });

      it('accepts path with no template brackets', () => {
        const result = validateDownloadPath('simple/path/name');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts multiple balanced bracket pairs', () => {
        const result = validateDownloadPath('{series}/{volume}/{chapter}');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Valid path acceptance', () => {
      it('accepts simple path', () => {
        const result = validateDownloadPath('manga');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with subdirectories', () => {
        const result = validateDownloadPath('manga/series/volume');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with hyphens and underscores', () => {
        const result = validateDownloadPath('manga-downloads/series_name');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with spaces', () => {
        const result = validateDownloadPath('My Manga/Series Name');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with dots', () => {
        const result = validateDownloadPath('manga/series.v2/chapter.1');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with parentheses and brackets', () => {
        const result = validateDownloadPath('manga/Series [2024] (v2)');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts complex template path', () => {
        const result = validateDownloadPath('{series_title}/Volume {volume_number}/{chapter_number} - {chapter_title}');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Edge cases', () => {
      it('trims whitespace before validation', () => {
        const result = validateDownloadPath('  manga/series  ');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('handles path with only valid special characters', () => {
        const result = validateDownloadPath('___---...');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with unicode characters', () => {
        const result = validateDownloadPath('漫画/シリーズ/章');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with emoji', () => {
        const result = validateDownloadPath('manga/📚series/📖chapter');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });
  });
}
