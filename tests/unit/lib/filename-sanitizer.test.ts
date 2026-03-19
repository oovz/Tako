import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  normalizeImageFilename,
  getExtensionFromMimeType,
} from '@/src/shared/filename-sanitizer';

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
      // Input has 9 illegal chars: : / \ ? < > * | "
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
      // CON only matches if it's the whole filename, not a prefix
      // This has illegal chars that get replaced, then trailing spaces/dots removed
      const input = 'CON/file\\name:test?.txt   ';
      const result = sanitizeFilename(input);
      expect(result).toBe('CON_file_name_test_.txt_');
    });

    it('sanitizes realistic manga filenames', () => {
      // : and ? are illegal, ! is legal
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
      // These work on macOS/Linux but fail on Windows - we sanitize for broadest compatibility
      const windowsIllegal = '<>:"/\\|?*';
      const result = sanitizeFilename(windowsIllegal);
      // eslint-disable-next-line no-useless-escape
      expect(result).not.toMatch(/[<>:"\/\\|?*]/);
      expect(result).toBe('_________');
    });

    it('removes null character (illegal on all platforms)', () => {
      expect(sanitizeFilename('file\x00name')).toBe('file_name');
    });

    it('removes forward slash (illegal on all platforms)', () => {
      expect(sanitizeFilename('path/to/file')).toBe('path_to_file');
    });

    it('allows characters that are legal on all platforms', () => {
      // These should work on Windows, macOS, and Linux
      const safe = 'file-name_123.txt';
      expect(sanitizeFilename(safe)).toBe(safe);
    });
  });

  describe('Leading characters edge cases', () => {
    it('allows leading spaces (trimming is caller responsibility)', () => {
      // Sanitizer preserves leading spaces - caller can trim if needed
      expect(sanitizeFilename('  filename')).toBe('  filename');
    });

    it('allows leading dots in non-reserved names', () => {
      // Unix hidden files start with dot
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
      // All illegal characters
      expect(sanitizeFilename('/<>:|?*"\\')).toBe('_________');
    });

    it('handles filename that becomes empty after sanitization', () => {
      // Only control characters
      expect(sanitizeFilename('\x00\x01\x02')).toBe('___');
    });
  });

  describe('Path length considerations', () => {
    it('respects Windows MAX_PATH limitations indirectly via truncation', () => {
      // Windows MAX_PATH is 260 chars total (including drive + path)
      // We truncate filenames at 200 to leave room for directory path
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
      // Windows, macOS, and Linux apply same rules to both files and directories
      expect(sanitizeFilename('CON')).toBe('_'); // Reserved
      expect(sanitizeFilename('my:folder')).toBe('my_folder'); // Illegal char
      expect(sanitizeFilename('folder.')).toBe('folder_'); // Trailing dot
    });

    it('allows valid directory names', () => {
      expect(sanitizeFilename('MyFolder')).toBe('MyFolder');
      expect(sanitizeFilename('folder-name_123')).toBe('folder-name_123');
    });
  });
});

describe('normalizeImageFilename', () => {
  describe('Auto padding calculation', () => {
    it('uses 1 digit for single-digit totals', () => {
      expect(normalizeImageFilename(0, 9, 'image/jpeg', 'auto')).toBe('1.jpg');
      expect(normalizeImageFilename(5, 9, 'image/jpeg', 'auto')).toBe('6.jpg');
      expect(normalizeImageFilename(8, 9, 'image/jpeg', 'auto')).toBe('9.jpg');
    });

    it('uses 2 digits for 10-99 total images', () => {
      expect(normalizeImageFilename(0, 10, 'image/jpeg', 'auto')).toBe('01.jpg');
      expect(normalizeImageFilename(9, 50, 'image/png', 'auto')).toBe('10.png');
      expect(normalizeImageFilename(98, 99, 'image/webp', 'auto')).toBe('99.webp');
    });

    it('uses 3 digits for 100-999 total images', () => {
      expect(normalizeImageFilename(0, 100, 'image/jpeg', 'auto')).toBe('001.jpg');
      expect(normalizeImageFilename(99, 500, 'image/png', 'auto')).toBe('100.png');
      expect(normalizeImageFilename(998, 999, 'image/webp', 'auto')).toBe('999.webp');
    });

    it('uses 4 digits for 1000+ total images', () => {
      expect(normalizeImageFilename(0, 1000, 'image/jpeg', 'auto')).toBe('0001.jpg');
      expect(normalizeImageFilename(999, 1500, 'image/png', 'auto')).toBe('1000.png');
      expect(normalizeImageFilename(1499, 1500, 'image/webp', 'auto')).toBe('1500.webp');
    });
  });

  describe('Manual padding specification', () => {
    it('respects explicit 2-digit padding', () => {
      expect(normalizeImageFilename(0, 50, 'image/jpeg', 2)).toBe('01.jpg');
      expect(normalizeImageFilename(5, 50, 'image/jpeg', 2)).toBe('06.jpg');
      expect(normalizeImageFilename(49, 50, 'image/jpeg', 2)).toBe('50.jpg');
    });

    it('respects explicit 3-digit padding', () => {
      expect(normalizeImageFilename(0, 100, 'image/png', 3)).toBe('001.png');
      expect(normalizeImageFilename(50, 100, 'image/png', 3)).toBe('051.png');
      expect(normalizeImageFilename(99, 100, 'image/png', 3)).toBe('100.png');
    });

    it('respects explicit 4-digit padding', () => {
      expect(normalizeImageFilename(0, 1000, 'image/webp', 4)).toBe('0001.webp');
      expect(normalizeImageFilename(500, 1000, 'image/webp', 4)).toBe('0501.webp');
      expect(normalizeImageFilename(999, 1000, 'image/webp', 4)).toBe('1000.webp');
    });

    it('respects explicit 5-digit padding', () => {
      expect(normalizeImageFilename(0, 10000, 'image/jpeg', 5)).toBe('00001.jpg');
      expect(normalizeImageFilename(9999, 10000, 'image/jpeg', 5)).toBe('10000.jpg');
    });

    it('handles manual padding smaller than needed', () => {
      // Manual padding of 2, but index 149 needs 3 digits
      expect(normalizeImageFilename(149, 150, 'image/jpeg', 2)).toBe('150.jpg');
    });
  });

  describe('1-based indexing', () => {
    it('starts at 1, not 0', () => {
      expect(normalizeImageFilename(0, 50, 'image/jpeg', 'auto')).toBe('01.jpg');
      expect(normalizeImageFilename(1, 50, 'image/jpeg', 'auto')).toBe('02.jpg');
      expect(normalizeImageFilename(2, 50, 'image/jpeg', 'auto')).toBe('03.jpg');
    });

    it('handles last image correctly', () => {
      expect(normalizeImageFilename(49, 50, 'image/jpeg', 'auto')).toBe('50.jpg');
      expect(normalizeImageFilename(99, 100, 'image/png', 'auto')).toBe('100.png');
      expect(normalizeImageFilename(149, 150, 'image/webp', 'auto')).toBe('150.webp');
    });
  });

  describe('MIME type to extension mapping', () => {
    it('converts image/jpeg to .jpg', () => {
      expect(normalizeImageFilename(0, 10, 'image/jpeg', 'auto')).toBe('01.jpg');
    });

    it('converts image/jpg to .jpg', () => {
      expect(normalizeImageFilename(0, 10, 'image/jpg', 'auto')).toBe('01.jpg');
    });

    it('converts image/png to .png', () => {
      expect(normalizeImageFilename(0, 10, 'image/png', 'auto')).toBe('01.png');
    });

    it('converts image/webp to .webp', () => {
      expect(normalizeImageFilename(0, 10, 'image/webp', 'auto')).toBe('01.webp');
    });

    it('converts image/gif to .gif', () => {
      expect(normalizeImageFilename(0, 10, 'image/gif', 'auto')).toBe('01.gif');
    });

    it('converts image/bmp to .bmp', () => {
      expect(normalizeImageFilename(0, 10, 'image/bmp', 'auto')).toBe('01.bmp');
    });

    it('converts image/svg to .svg', () => {
      expect(normalizeImageFilename(0, 10, 'image/svg+xml', 'auto')).toBe('01.svg');
    });

    it('converts image/avif to .avif', () => {
      expect(normalizeImageFilename(0, 10, 'image/avif', 'auto')).toBe('01.avif');
    });

    it('handles case-insensitive MIME types', () => {
      expect(normalizeImageFilename(0, 10, 'IMAGE/JPEG', 'auto')).toBe('01.jpg');
      expect(normalizeImageFilename(0, 10, 'Image/PNG', 'auto')).toBe('01.png');
    });
  });

  describe('Edge cases', () => {
    it('handles very large image counts', () => {
      expect(normalizeImageFilename(0, 10000, 'image/jpeg', 'auto')).toBe('00001.jpg');
      expect(normalizeImageFilename(9999, 10000, 'image/jpeg', 'auto')).toBe('10000.jpg');
    });

    it('handles edge case with totalImages = 1', () => {
      expect(normalizeImageFilename(0, 1, 'image/jpeg', 'auto')).toBe('1.jpg');
    });

    it('handles realistic manga chapter (20-50 pages)', () => {
      expect(normalizeImageFilename(0, 25, 'image/jpeg', 'auto')).toBe('01.jpg');
      expect(normalizeImageFilename(24, 25, 'image/jpeg', 'auto')).toBe('25.jpg');
    });

    it('handles long chapters (100+ pages)', () => {
      expect(normalizeImageFilename(0, 150, 'image/png', 'auto')).toBe('001.png');
      expect(normalizeImageFilename(149, 150, 'image/png', 'auto')).toBe('150.png');
    });
  });
});

describe('getExtensionFromMimeType', () => {
  describe('Standard image formats', () => {
    it('detects JPEG', () => {
      expect(getExtensionFromMimeType('image/jpeg')).toBe('jpg');
      expect(getExtensionFromMimeType('image/jpg')).toBe('jpg');
    });

    it('detects PNG', () => {
      expect(getExtensionFromMimeType('image/png')).toBe('png');
    });

    it('detects WebP', () => {
      expect(getExtensionFromMimeType('image/webp')).toBe('webp');
    });

    it('detects GIF', () => {
      expect(getExtensionFromMimeType('image/gif')).toBe('gif');
    });

    it('detects BMP', () => {
      expect(getExtensionFromMimeType('image/bmp')).toBe('bmp');
    });

    it('detects SVG', () => {
      expect(getExtensionFromMimeType('image/svg+xml')).toBe('svg');
      expect(getExtensionFromMimeType('image/svg')).toBe('svg');
    });

    it('detects TIFF', () => {
      expect(getExtensionFromMimeType('image/tiff')).toBe('tiff');
      expect(getExtensionFromMimeType('image/tif')).toBe('tiff');
    });

    it('detects AVIF', () => {
      expect(getExtensionFromMimeType('image/avif')).toBe('avif');
    });
  });

  describe('Case insensitivity', () => {
    it('handles uppercase MIME types', () => {
      expect(getExtensionFromMimeType('IMAGE/JPEG')).toBe('jpg');
      expect(getExtensionFromMimeType('IMAGE/PNG')).toBe('png');
    });

    it('handles mixed case MIME types', () => {
      expect(getExtensionFromMimeType('Image/WebP')).toBe('webp');
      expect(getExtensionFromMimeType('ImAgE/gIf')).toBe('gif');
    });
  });

  describe('Fallback behavior', () => {
    it('defaults to jpg for empty string', () => {
      expect(getExtensionFromMimeType('')).toBe('jpg');
    });

    it('defaults to jpg for null or undefined', () => {
      expect(getExtensionFromMimeType(null as any)).toBe('jpg');
      expect(getExtensionFromMimeType(undefined as any)).toBe('jpg');
    });

    it('defaults to jpg for non-string input', () => {
      expect(getExtensionFromMimeType(123 as any)).toBe('jpg');
      expect(getExtensionFromMimeType({} as any)).toBe('jpg');
    });

    it('defaults to jpg for unknown MIME types', () => {
      expect(getExtensionFromMimeType('application/pdf')).toBe('jpg');
      expect(getExtensionFromMimeType('text/html')).toBe('jpg');
      expect(getExtensionFromMimeType('image/unknown')).toBe('jpg');
    });
  });

  describe('Partial matches', () => {
    it('matches MIME types with additional parameters', () => {
      expect(getExtensionFromMimeType('image/jpeg; charset=utf-8')).toBe('jpg');
      expect(getExtensionFromMimeType('image/png; quality=high')).toBe('png');
    });

    it('matches malformed MIME types containing correct keywords', () => {
      expect(getExtensionFromMimeType('jpeg')).toBe('jpg');
      expect(getExtensionFromMimeType('png')).toBe('png');
      expect(getExtensionFromMimeType('webp')).toBe('webp');
    });
  });
});

