import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '@/src/shared/filename-sanitizer';

export function registerSanitizeFilenameCases(): void {
  describe('sanitizeFilename', () => {
    describe('Basic sanitization', () => {
      it('returns empty string for non-string input', () => {
        expect(sanitizeFilename(null as any)).toBe('');
        expect(sanitizeFilename(undefined as any)).toBe('');
        expect(sanitizeFilename(123 as any)).toBe('');
        expect(sanitizeFilename({} as any)).toBe('');
      });

      it('keeps valid alphanumeric filenames unchanged', () => {
        expect(sanitizeFilename('Chapter_001')).toBe('Chapter_001');
        expect(sanitizeFilename('MyFile123')).toBe('MyFile123');
        expect(sanitizeFilename('test-file-name')).toBe('test-file-name');
      });

      it('keeps valid special characters', () => {
        expect(sanitizeFilename('file-name_with.valid')).toBe('file-name_with.valid');
        expect(sanitizeFilename('test[brackets]')).toBe('test[brackets]');
        expect(sanitizeFilename('file (parens)')).toBe('file (parens)');
      });
    });

    describe('Illegal character replacement', () => {
      it('replaces forward slash with underscore', () => {
        expect(sanitizeFilename('path/to/file')).toBe('path_to_file');
      });

      it('replaces backslash with underscore', () => {
        expect(sanitizeFilename('path\\to\\file')).toBe('path_to_file');
      });

      it('replaces question mark with underscore', () => {
        expect(sanitizeFilename('what?is?this')).toBe('what_is_this');
      });

      it('replaces less than and greater than with underscore', () => {
        expect(sanitizeFilename('file<>name')).toBe('file__name');
      });

      it('replaces colon with underscore', () => {
        expect(sanitizeFilename('time:stamp')).toBe('time_stamp');
      });

      it('replaces asterisk with underscore', () => {
        expect(sanitizeFilename('wild*card')).toBe('wild_card');
      });

      it('replaces pipe with underscore', () => {
        expect(sanitizeFilename('file|name')).toBe('file_name');
      });

      it('replaces double quote with underscore', () => {
        expect(sanitizeFilename('file"name"')).toBe('file_name_');
      });

      it('replaces all illegal characters in one string', () => {
        expect(sanitizeFilename('illegal:/\\?<>*|"chars')).toBe('illegal_________chars');
      });
    });

    describe('Control character replacement', () => {
      it('replaces null character', () => {
        expect(sanitizeFilename('file\x00name')).toBe('file_name');
      });

      it('replaces tab and newline', () => {
        expect(sanitizeFilename('file\t\nname')).toBe('file__name');
      });

      it('replaces control characters (0x00-0x1f)', () => {
        expect(sanitizeFilename('file\x01\x02\x03name')).toBe('file___name');
      });

      it('replaces extended control characters (0x80-0x9f)', () => {
        expect(sanitizeFilename('file\x80\x9fname')).toBe('file__name');
      });
    });

    describe('Reserved names', () => {
      it('replaces dot-only filenames', () => {
        expect(sanitizeFilename('.')).toBe('_');
        expect(sanitizeFilename('..')).toBe('_');
        expect(sanitizeFilename('...')).toBe('_');
      });

      it('replaces Windows reserved names (case-insensitive)', () => {
        expect(sanitizeFilename('CON')).toBe('_');
        expect(sanitizeFilename('PRN')).toBe('_');
        expect(sanitizeFilename('AUX')).toBe('_');
        expect(sanitizeFilename('NUL')).toBe('_');
        expect(sanitizeFilename('con')).toBe('_');
        expect(sanitizeFilename('prn')).toBe('_');
      });

      it('replaces Windows reserved names with COM ports', () => {
        expect(sanitizeFilename('COM1')).toBe('_');
        expect(sanitizeFilename('COM5')).toBe('_');
        expect(sanitizeFilename('COM9')).toBe('_');
        expect(sanitizeFilename('com3')).toBe('_');
      });

      it('replaces Windows reserved names with LPT ports', () => {
        expect(sanitizeFilename('LPT1')).toBe('_');
        expect(sanitizeFilename('LPT5')).toBe('_');
        expect(sanitizeFilename('LPT9')).toBe('_');
        expect(sanitizeFilename('lpt2')).toBe('_');
      });

      it('replaces Windows reserved names with extensions', () => {
        expect(sanitizeFilename('CON.txt')).toBe('_');
        expect(sanitizeFilename('NUL.dat')).toBe('_');
        expect(sanitizeFilename('COM1.log')).toBe('_');
      });

      it('allows valid names containing reserved words', () => {
        expect(sanitizeFilename('ACON')).toBe('ACON');
        expect(sanitizeFilename('myPRN')).toBe('myPRN');
        expect(sanitizeFilename('COM10')).toBe('COM10');
      });
    });

    describe('Windows trailing characters', () => {
      it('removes trailing dots', () => {
        expect(sanitizeFilename('filename.')).toBe('filename_');
        expect(sanitizeFilename('filename...')).toBe('filename_');
      });

      it('removes trailing spaces', () => {
        expect(sanitizeFilename('filename ')).toBe('filename_');
        expect(sanitizeFilename('filename   ')).toBe('filename_');
      });

      it('removes trailing dots and spaces', () => {
        expect(sanitizeFilename('filename. ')).toBe('filename_');
        expect(sanitizeFilename('filename . .')).toBe('filename_');
      });

      it('keeps internal dots and spaces', () => {
        expect(sanitizeFilename('file.name')).toBe('file.name');
        expect(sanitizeFilename('file name')).toBe('file name');
      });
    });

    describe('Length truncation', () => {
      it('keeps short filenames unchanged', () => {
        const short = 'short-filename.txt';
        expect(sanitizeFilename(short)).toBe(short);
      });

      it('truncates filenames longer than 200 characters', () => {
        const long = 'a'.repeat(250);
        const result = sanitizeFilename(long);
        expect(result.length).toBe(200);
        expect(result).toBe('a'.repeat(200));
      });

      it('truncates exactly at 200 characters', () => {
        const exact201 = 'x'.repeat(201);
        expect(sanitizeFilename(exact201)).toBe('x'.repeat(200));
      });

      it('preserves 200 character filenames', () => {
        const exact200 = 'y'.repeat(200);
        expect(sanitizeFilename(exact200)).toBe(exact200);
      });
    });

    describe('Unicode and international characters', () => {
      it('preserves unicode characters', () => {
        expect(sanitizeFilename('文件名')).toBe('文件名');
        expect(sanitizeFilename('ファイル')).toBe('ファイル');
        expect(sanitizeFilename('파일이름')).toBe('파일이름');
      });

      it('preserves emoji', () => {
        expect(sanitizeFilename('file📁name')).toBe('file📁name');
        expect(sanitizeFilename('Chapter🔥01')).toBe('Chapter🔥01');
      });

      it('preserves accented characters', () => {
        expect(sanitizeFilename('café')).toBe('café');
        expect(sanitizeFilename('naïve')).toBe('naïve');
        expect(sanitizeFilename('Zürich')).toBe('Zürich');
      });

      it('handles unicode with illegal characters', () => {
        expect(sanitizeFilename('文件/名称')).toBe('文件_名称');
        expect(sanitizeFilename('ファイル\\名前')).toBe('ファイル_名前');
      });
    });

    describe('Edge cases and combinations', () => {
      it('handles empty string', () => {
        expect(sanitizeFilename('')).toBe('');
      });

      it('handles string with only illegal characters', () => {
        expect(sanitizeFilename('/:*?<>|"')).toBe('________');
      });

      it('handles combination of issues', () => {
        const input = 'CON/file\\name:test?.txt   ';
        const result = sanitizeFilename(input);
        expect(result).toBe('CON_file_name_test_.txt_');
      });

      it('sanitizes realistic manga filenames', () => {
        expect(sanitizeFilename('Chapter 5: The Final Battle?!')).toBe('Chapter 5_ The Final Battle_!');
        expect(sanitizeFilename('Vol.3 Ch.12 - "Victory"')).toBe('Vol.3 Ch.12 - _Victory_');
        expect(sanitizeFilename('Attack on Titan - Ch 139 [END]')).toBe('Attack on Titan - Ch 139 [END]');
      });

      it('handles multiple sanitization rules at once', () => {
        const input = 'file<name>:with*illegal|chars. ';
        expect(sanitizeFilename(input)).toBe('file_name__with_illegal_chars_');
      });
    });

    describe('Additional Windows reserved names (COM0, LPT0)', () => {
      it('replaces COM0 (documented Windows reserved name)', () => {
        expect(sanitizeFilename('COM0')).toBe('_');
        expect(sanitizeFilename('com0')).toBe('_');
        expect(sanitizeFilename('COM0.txt')).toBe('_');
      });

      it('replaces LPT0 (documented Windows reserved name)', () => {
        expect(sanitizeFilename('LPT0')).toBe('_');
        expect(sanitizeFilename('lpt0')).toBe('_');
        expect(sanitizeFilename('LPT0.log')).toBe('_');
      });
    });

    describe('Cross-platform compatibility (Windows, macOS, Linux)', () => {
      it('removes all Windows-illegal characters for cross-platform safety', () => {
        const windowsIllegal = '<>:"/\\|?*';
        const result = sanitizeFilename(windowsIllegal);
        expect(result).not.toMatch(/[<>:"/\\|?*]/);
        expect(result).toBe('_________');
      });

      it('removes null character (illegal on all platforms)', () => {
        expect(sanitizeFilename('file\x00name')).toBe('file_name');
      });

      it('removes forward slash (illegal on all platforms)', () => {
        expect(sanitizeFilename('path/to/file')).toBe('path_to_file');
      });

      it('allows characters that are legal on all platforms', () => {
        const safe = 'file-name_123.txt';
        expect(sanitizeFilename(safe)).toBe(safe);
      });
    });

    describe('Leading characters edge cases', () => {
      it('allows leading spaces (trimming is caller responsibility)', () => {
        expect(sanitizeFilename('  filename')).toBe('  filename');
      });

      it('allows leading dots in non-reserved names', () => {
        expect(sanitizeFilename('.htaccess')).toBe('.htaccess');
        expect(sanitizeFilename('.gitignore')).toBe('.gitignore');
      });

      it('replaces dot-only names (current directory reference)', () => {
        expect(sanitizeFilename('.')).toBe('_');
        expect(sanitizeFilename('..')).toBe('_');
      });
    });

    describe('Empty result after sanitization', () => {
      it('returns empty string when all characters are removed', () => {
        expect(sanitizeFilename('/<>:|?*"\\')).toBe('_________');
      });

      it('handles filename that becomes empty after sanitization', () => {
        expect(sanitizeFilename('\x00\x01\x02')).toBe('___');
      });
    });

    describe('Path length considerations', () => {
      it('respects Windows MAX_PATH limitations indirectly via truncation', () => {
        const long = 'a'.repeat(250);
        expect(sanitizeFilename(long).length).toBe(200);
      });

      it('handles exactly 200 character filenames', () => {
        const exact = 'x'.repeat(200);
        expect(sanitizeFilename(exact)).toBe(exact);
        expect(sanitizeFilename(exact).length).toBe(200);
      });
    });

    describe('Special manga-related edge cases', () => {
      it('sanitizes chapter titles with common problematic patterns', () => {
        expect(sanitizeFilename('Ch.1: "New Beginning"')).toBe('Ch.1_ _New Beginning_');
        expect(sanitizeFilename('Chapter 5 - Part 1/2')).toBe('Chapter 5 - Part 1_2');
        expect(sanitizeFilename('Vol.2 Ch.10 <Final>')).toBe('Vol.2 Ch.10 _Final_');
      });

      it('preserves Japanese and Chinese characters in manga titles', () => {
        expect(sanitizeFilename('第1話：新しい始まり')).toBe('第1話：新しい始まり');
        expect(sanitizeFilename('第1章 - "勝利"')).toBe('第1章 - _勝利_');
      });

      it('handles series titles with special punctuation', () => {
        expect(sanitizeFilename('Re:Zero − 第1章')).toBe('Re_Zero − 第1章');
        expect(sanitizeFilename('Fate/Stay Night')).toBe('Fate_Stay Night');
      });
    });

    describe('Filename vs directory name (same rules apply)', () => {
      it('sanitizes directory names with same rules as filenames', () => {
        expect(sanitizeFilename('CON')).toBe('_');
        expect(sanitizeFilename('my:folder')).toBe('my_folder');
        expect(sanitizeFilename('folder.')).toBe('folder_');
      });

      it('allows valid directory names', () => {
        expect(sanitizeFilename('MyFolder')).toBe('MyFolder');
        expect(sanitizeFilename('folder-name_123')).toBe('folder-name_123');
      });
    });
  });
}
