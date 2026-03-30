import { describe, expect, it, vi } from 'vitest';
import {
  COMICINFO_FIELDS,
  COMICINFO_VERSION_SUPPORT,
  getSupportedFields,
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

  describe('getSupportedFields', () => {
    it('returns array of field definitions', () => {
      const fields = getSupportedFields();

      expect(Array.isArray(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
    });

    it('includes field names and types', () => {
      const fields = getSupportedFields();
      const titleField = fields.find(f => f.name === 'Title');

      expect(titleField).toBeDefined();
      expect(titleField?.type).toBe('string');
      expect(titleField?.required).toBe(false);
    });

    it('includes all standard ComicInfo fields', () => {
      const fields = getSupportedFields();
      const fieldNames = fields.map(f => f.name);

      expect(fieldNames).toContain('Title');
      expect(fieldNames).toContain('Series');
      expect(fieldNames).toContain('Number');
      expect(fieldNames).toContain('Writer');
      expect(fieldNames).toContain('Year');
      expect(fieldNames).toContain('PageCount');
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

  describe('COMICINFO_VERSION_SUPPORT', () => {
    it('defines version 2.0 support', () => {
      expect(COMICINFO_VERSION_SUPPORT['2.0']).toBeDefined();
      expect(COMICINFO_VERSION_SUPPORT['2.0'].version).toBe('2.0');
    });

    it('includes all v2.0 supported fields', () => {
      const fields = COMICINFO_VERSION_SUPPORT['2.0'].supportedFields;

      expect(fields).toContain('Title');
      expect(fields).toContain('Series');
      expect(fields).toContain('Writer');
      expect(fields).toContain('PageCount');
      expect(fields).toContain('Manga');
    });

    it('defines enum values for Manga and BlackAndWhite', () => {
      const enums = COMICINFO_VERSION_SUPPORT['2.0'].enumValues;

      expect(enums.Manga).toContain('Yes');
      expect(enums.Manga).toContain('No');
      expect(enums.BlackAndWhite).toContain('Yes');
      expect(enums.BlackAndWhite).toContain('No');
    });
  });

  describe('COMICINFO_FIELDS', () => {
    it('defines Title field', () => {
      expect(COMICINFO_FIELDS.Title).toBeDefined();
      expect(COMICINFO_FIELDS.Title.type).toBe('string');
    });

    it('defines numeric fields correctly', () => {
      expect(COMICINFO_FIELDS.Year.type).toBe('number');
      expect(COMICINFO_FIELDS.PageCount.type).toBe('number');
      expect(COMICINFO_FIELDS.Volume.type).toBe('number');
    });

    it('marks all fields as not required', () => {
      const fields = Object.values(COMICINFO_FIELDS);

      fields.forEach(field => {
        expect(field.required).toBe(false);
      });
    });
  });
}
