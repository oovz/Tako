import { describe, expect, it, vi } from 'vitest';
import {
  integrationSupportsMetadata,
  validateComicInfo,
} from '@/src/shared/comicinfo-generator';
import type { ComicInfoV2 } from '@/src/types/comic-info';

export function registerComicInfoApiCases(): void {
  describe('validateComicInfo', () => {
    it('validates correct metadata', () => {
      const metadata: ComicInfoV2 = {
        Title: 'Chapter 1',
        Series: 'Test Series',
        Number: '1',
      };

      const result = validateComicInfo(metadata);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports unknown fields as warnings', () => {
      const metadataWithUnknown = {
        Title: 'Chapter 1',
        UnknownField: 'value',
      } as ComicInfoV2;

      const result = validateComicInfo(metadataWithUnknown);

      expect(result.warnings).toContain('Unknown field: UnknownField');
    });

    it('validates numeric fields', () => {
      const metadata: ComicInfoV2 = {
        Title: 'Chapter 1',
        Year: 2024,
        Month: 6,
      };

      const result = validateComicInfo(metadata);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts empty metadata', () => {
      const result = validateComicInfo({});

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('integrationSupportsMetadata', () => {
    it('returns true for site integration with extractSeriesMetadata', () => {
      const integration = {
        series: {
          extractSeriesMetadata: vi.fn(),
        },
      };

      const result = integrationSupportsMetadata(integration);

      expect(result).toBe(true);
    });

    it('returns false for site integration without series', () => {
      const integration = {};

      const result = integrationSupportsMetadata(integration);

      expect(result).toBe(false);
    });

    it('returns false for site integration without extractSeriesMetadata', () => {
      const integration = {
        series: {},
      };

      const result = integrationSupportsMetadata(integration);

      expect(result).toBe(false);
    });

    it('returns false for null site integration', () => {
      const result = integrationSupportsMetadata(null);

      expect(result).toBe(false);
    });
  });

}
