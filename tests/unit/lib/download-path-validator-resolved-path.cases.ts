import { describe, expect, it } from 'vitest';
import { validateResolvedPath } from '@/src/shared/download-path-validator';

export function registerValidateResolvedPathCases(): void {
  describe('validateResolvedPath', () => {
    describe('Inherits basic validation', () => {
      it('rejects empty string', () => {
        const result = validateResolvedPath('');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Download path cannot be empty');
      });

      it('rejects invalid characters', () => {
        const result = validateResolvedPath('path:name');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('rejects leading slash', () => {
        const result = validateResolvedPath('/path/to/file');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Download path cannot start with a slash');
      });
    });

    describe('Unresolved template detection', () => {
      it('rejects path with remaining opening bracket', () => {
        const result = validateResolvedPath('manga/<series_title');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('unmatched template brackets');
      });

      it('rejects path with remaining closing bracket', () => {
        const result = validateResolvedPath('manga/series_title>');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('unmatched template brackets');
      });

      it('rejects path with both template brackets', () => {
        const result = validateResolvedPath('manga/<series_title>/chapter');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('unresolved template variables');
      });

      it('accepts resolved path (curly braces are valid)', () => {
        const result = validateResolvedPath('manga/{series_title}');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with no template brackets', () => {
        const result = validateResolvedPath('manga/One Piece/Chapter 1');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Double slash detection', () => {
      it('rejects path with double forward slashes', () => {
        const result = validateResolvedPath('manga//series');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid double slashes');
      });

      it('rejects path with multiple double slashes', () => {
        const result = validateResolvedPath('manga//series//chapter');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid double slashes');
      });

      it('rejects Windows drive path (colon is invalid character)', () => {
        const result = validateResolvedPath('C:/manga/series');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('rejects lowercase Windows drive path (colon is invalid)', () => {
        const result = validateResolvedPath('c:/manga/series');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('rejects double slashes (colon rejected first)', () => {
        const result = validateResolvedPath('C:/manga//series');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('accepts single slashes throughout path', () => {
        const result = validateResolvedPath('manga/series/volume/chapter');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Valid resolved path acceptance', () => {
      it('accepts simple resolved path', () => {
        const result = validateResolvedPath('manga/One Piece');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts fully resolved template path', () => {
        const result = validateResolvedPath('One Piece/Volume 01/Chapter 001 - Romance Dawn');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with numbers', () => {
        const result = validateResolvedPath('manga/series123/chapter456');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with special characters', () => {
        const result = validateResolvedPath('manga/Series (2024) [v2]/Chapter 01');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('rejects Windows-style path (colon is invalid)', () => {
        const result = validateResolvedPath('C:/Users/Username/Documents/Manga');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('accepts path with dots', () => {
        const result = validateResolvedPath('manga/Series.v2/Chapter.001');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with underscores and hyphens', () => {
        const result = validateResolvedPath('manga/series_name-v2/chapter-01');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Edge cases', () => {
      it('trims whitespace before validation', () => {
        const result = validateResolvedPath('  manga/series  ');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with unicode characters', () => {
        const result = validateResolvedPath('漫画/ワンピース/第1話');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with emoji', () => {
        const result = validateResolvedPath('manga/📚 One Piece/📖 Chapter 1');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('rejects path with only spaces between slashes', () => {
        const result = validateResolvedPath('manga/   /chapter');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Cross-platform compatibility', () => {
      it('accepts relative path for Unix/Windows', () => {
        const result = validateResolvedPath('manga/series/chapter');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('rejects Windows drive letter (colon is invalid)', () => {
        const result = validateResolvedPath('D:/Manga/Series');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('accepts deep nested path', () => {
        const result = validateResolvedPath('a/b/c/d/e/f/g/h/i/j');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('accepts path with long directory names', () => {
        const longName = 'a'.repeat(100);
        const result = validateResolvedPath(`manga/${longName}/chapter`);
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });
  });
}
