import { describe, expect, it } from 'vitest';
import { getExtensionFromMimeType } from '@/src/shared/filename-sanitizer';

export function registerMimeTypeExtensionCases(): void {
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
}
