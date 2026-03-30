import { describe, expect, it } from 'vitest';
import { normalizeImageFilename } from '@/src/shared/filename-sanitizer';

export function registerNormalizeImageFilenameCases(): void {
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
}
