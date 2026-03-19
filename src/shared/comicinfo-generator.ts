/**
 * ComicInfo.xml Generator Utility
 * Generates ComicInfo.xml metadata files for comic book archives (CBZ)
 * 
 * Based on the ComicInfo.xml schema from the Anansi Project:
 * https://github.com/anansi-project/comicinfo
 * 
 * This utility creates XML metadata that is compatible with popular comic readers
 * like Komga, Kavita, and other ComicInfo.xml-supporting applications.
 */

import type { ComicInfoV2, ComicInfoVersionSupport } from '../types/comic-info';
import logger from '@/src/runtime/logger';

/**
 * ComicInfo version compatibility definitions - P1-3: Only v2.0 supported
 */
export const COMICINFO_VERSION_SUPPORT: Record<'2.0', ComicInfoVersionSupport> = {
  '2.0': {
    version: '2.0',
    supportedFields: [
      // All fields from v2.0 spec
      'Title', 'Series', 'Number', 'Count', 'Volume',
      'AlternateSeries', 'AlternateNumber', 'AlternateCount',
      'Summary', 'Notes', 'Year', 'Month', 'Day',
      'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'CoverArtist', 'Editor',
      'Publisher', 'Imprint', 'Genre', 'Web', 'PageCount', 'LanguageISO', 'Format',
      'BlackAndWhite', 'Manga', 'Characters', 'Teams', 'Locations', 'MainCharacterOrTeam',
      'StoryArc', 'SeriesGroup', 'AgeRating', 'CommunityRating', 'Review',
      'ScanInformation', 'Pages'
    ],
    requiredFields: [],
    enumValues: {
      BlackAndWhite: ['Yes', 'No', 'Unknown'],
      Manga: ['Yes', 'No', 'Unknown', 'YesAndRightToLeft']
    }
  }
};

/**
 * ComicInfo.xml field definitions and validation
 */
interface ComicInfoField {
  type: 'string' | 'number';
  required: boolean;
  description: string;
}

const COMICINFO_FIELDS: Record<string, ComicInfoField> = {
  // Basic Information
  Title: { type: 'string', required: false, description: 'Title of the chapter/book' },
  Series: { type: 'string', required: false, description: 'Title of the series' },
  Number: { type: 'string', required: false, description: 'Chapter/issue number' },
  Count: { type: 'number', required: false, description: 'Total number of chapters/issues in series' },
  Volume: { type: 'number', required: false, description: 'Volume number' },
  
  // Creator Information
  Writer: { type: 'string', required: false, description: 'Writer/Author (comma-separated if multiple)' },
  Penciller: { type: 'string', required: false, description: 'Artist responsible for pencil art' },
  Inker: { type: 'string', required: false, description: 'Artist responsible for inking' },
  Colorist: { type: 'string', required: false, description: 'Artist responsible for coloring' },
  Letterer: { type: 'string', required: false, description: 'Artist responsible for lettering' },
  CoverArtist: { type: 'string', required: false, description: 'Artist responsible for cover art' },
  Editor: { type: 'string', required: false, description: 'Editor' },
  
  // Publication Information
  Publisher: { type: 'string', required: false, description: 'Publisher or scanlation group' },
  Imprint: { type: 'string', required: false, description: 'Publisher imprint' },
  Year: { type: 'number', required: false, description: 'Publication year' },
  Month: { type: 'number', required: false, description: 'Publication month (1-12)' },
  Day: { type: 'number', required: false, description: 'Publication day (1-31)' },
  
  // Content Information
  Summary: { type: 'string', required: false, description: 'Description or summary' },
  Notes: { type: 'string', required: false, description: 'Additional notes' },
  PageCount: { type: 'number', required: false, description: 'Number of pages' },
  Genre: { type: 'string', required: false, description: 'Genre tags (comma-separated)' },
  Characters: { type: 'string', required: false, description: 'Main characters (comma-separated)' },
  
  // Alternative Series Information
  AlternateSeries: { type: 'string', required: false, description: 'Alternative series name' },
  AlternateNumber: { type: 'string', required: false, description: 'Alternative series number' },
  AlternateCount: { type: 'number', required: false, description: 'Alternative series count' },
  
  // Technical Information
  Format: { type: 'string', required: false, description: 'Format information' },
  LanguageISO: { type: 'string', required: false, description: 'Language code (ISO 639-1)' },
  Web: { type: 'string', required: false, description: 'Website URL' },
  
  // Age Rating
  AgeRating: { type: 'string', required: false, description: 'Age rating' },
  
  // Story Arc Information
  StoryArc: { type: 'string', required: false, description: 'Story arc name' },
  
  // Community Rating
  CommunityRating: { type: 'number', required: false, description: 'Community rating (0-5)' }
};

/**
 * Escape XML special characters
 * @param text - Text to escape
 * @returns Escaped text
 */
function escapeXML(text: string | number): string {
  if (typeof text !== 'string') {
    return String(text);
  }
  
  return text.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return char;
    }
  });
}

/**
 * Validate metadata field value
 * @param fieldName - Name of the field
 * @param value - Value to validate
 * @returns Whether the value is valid
 */
function validateField(fieldName: string, value: unknown): boolean {
  const field = COMICINFO_FIELDS[fieldName];
  if (!field) {
    logger.warn(`ComicInfo: Unknown field "${fieldName}"`);
    return false;
  }
  
  if (value === null || value === undefined || value === '') {
    return !field.required;
  }
  
  switch (field.type) {
    case 'string':
      return typeof value === 'string' || typeof value === 'number';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    default:
      return true;
  }
}

/**
 * Clean and validate metadata object
 * @param metadata - Metadata object
 * @returns Cleaned metadata object
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function cleanMetadata(metadata: ComicInfoV2): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (validateField(key, value)) {
      // Convert to appropriate type
      const field = COMICINFO_FIELDS[key];
      if (field && field.type === 'number' && typeof value === 'string') {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          cleaned[key] = numValue;
        }
      } else {
        cleaned[key] = value;
      }
    }
  }
  
  return cleaned;
}

/**
 * Filter metadata fields based on version support (always v2.0)
 */
function filterMetadataByVersion(
  metadata: ComicInfoV2, 
  versionSupport: typeof COMICINFO_VERSION_SUPPORT['2.0']
): ComicInfoV2 {
  const filtered: ComicInfoV2 = {};
  
  for (const [fieldKey, value] of Object.entries(metadata) as Array<[
    keyof ComicInfoV2,
    ComicInfoV2[keyof ComicInfoV2]
  ]>) {
    if (versionSupport.supportedFields.includes(fieldKey)) {
      (filtered as Record<string, unknown>)[fieldKey] = value;
    }
  }
  
  // Handle enum value filtering for version-specific enums
  if (filtered.Manga && !versionSupport.enumValues.Manga.includes(String(filtered.Manga))) {
    // Fallback to 'Yes' if unsupported enum value
    filtered.Manga = 'Yes';
  }
  
  return filtered;
}

/**
 * Clean and validate unified metadata
 */
function cleanUnifiedMetadata(metadata: ComicInfoV2): ComicInfoV2 {
  const cleaned: ComicInfoV2 = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== null && value !== undefined && value !== '') {
      const fieldKey = key as keyof ComicInfoV2;
      
      // Type-specific cleaning
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          (cleaned as Record<string, unknown>)[fieldKey] = trimmed;
        }
      } else if (typeof value === 'number') {
        if (value > 0 || ['Year', 'Month', 'Day', 'Count', 'Volume', 'PageCount'].includes(key)) {
          (cleaned as Record<string, unknown>)[fieldKey] = value;
        }
      } else {
        (cleaned as Record<string, unknown>)[fieldKey] = value;
      }
    }
  }
  
  return cleaned;
}

/**
 * Generate version-specific XML content
 * @param metadata - Cleaned metadata
 * @param hasCoverImage - Whether to mark cover page
 */
function generateVersionSpecificXML(metadata: ComicInfoV2, hasCoverImage: boolean = false): string {
  // P1-3: Always generates ComicInfo v2.0 XML
  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n';
  
  // Field order optimized for ComicInfo v2.0 specification
  const fieldOrder: (keyof ComicInfoV2)[] = [
    'Title', 'Series', 'Number', 'Count', 'Volume',
    'AlternateSeries', 'AlternateNumber', 'AlternateCount',
    'Summary', 'Notes',
    'Year', 'Month', 'Day',
    'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'CoverArtist', 'Editor',
    'Publisher', 'Imprint',
    'Genre', 'Characters', 'Teams', 'Locations', 'MainCharacterOrTeam',
    'Web', 'Format', 'LanguageISO', 'AgeRating',
    'BlackAndWhite', 'Manga',
    'StoryArc', 'SeriesGroup',
    'CommunityRating', 'Review', 'ScanInformation',
    'PageCount'
  ];
  
  // Add fields in order
  for (const fieldName of fieldOrder) {
    const value = metadata[fieldName];
    if (value !== null && value !== undefined && value !== '') {
      // Skip Pages array - handle separately if needed
      if (fieldName === 'Pages') continue;
      const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      xml += `  <${fieldName}>${escapeXML(strValue)}</${fieldName}>\n`;
    }
  }
  
  // Add any additional fields not in the standard order
  for (const [fieldName, value] of Object.entries(metadata)) {
    if (!fieldOrder.includes(fieldName as keyof ComicInfoV2) && 
        fieldName !== 'Pages' &&
        value !== null && value !== undefined && value !== '') {
      xml += `  <${fieldName}>${escapeXML(String(value))}</${fieldName}>\n`;
    }
  }
  
  const explicitPages = Array.isArray(metadata.Pages) ? metadata.Pages : undefined

  // Add Pages section from explicit page metadata when provided.
  if (explicitPages && explicitPages.length > 0) {
    xml += '  <Pages>\n';
    for (const page of explicitPages) {
      const attributes = [`Image="${page.Image}"`]
      if (page.Type) {
        attributes.push(`Type="${escapeXML(page.Type)}"`)
      }
      if (typeof page.DoublePage === 'boolean') {
        attributes.push(`DoublePage="${page.DoublePage}"`)
      }
      if (typeof page.ImageSize === 'number') {
        attributes.push(`ImageSize="${page.ImageSize}"`)
      }
      if (page.Key) {
        attributes.push(`Key="${escapeXML(page.Key)}"`)
      }
      if (page.Bookmark) {
        attributes.push(`Bookmark="${escapeXML(page.Bookmark)}"`)
      }
      if (typeof page.ImageWidth === 'number') {
        attributes.push(`ImageWidth="${page.ImageWidth}"`)
      }
      if (typeof page.ImageHeight === 'number') {
        attributes.push(`ImageHeight="${page.ImageHeight}"`)
      }

      xml += `    <Page ${attributes.join(' ')} />\n`
    }
    xml += '  </Pages>\n';
  }
  // Otherwise derive a simple Pages section when we only know there is a cover image.
  else if (hasCoverImage && metadata.PageCount && metadata.PageCount > 0) {
    xml += '  <Pages>\n';
    // First page is the cover
    xml += '    <Page Image="0" Type="FrontCover" />\n';
    // Remaining pages are chapter content
    for (let i = 1; i < metadata.PageCount; i++) {
      xml += `    <Page Image="${i}" />\n`;
    }
    xml += '  </Pages>\n';
  }
  
  xml += '</ComicInfo>';
  return xml;
}

/**
 * Generate ComicInfo.xml content from metadata
 * @param metadata - Metadata object from the site integration
 * @param pageCount - Number of pages in the chapter
 * @param version - ComicInfo schema version (always '2.0')
 * @param hasCoverImage - Whether a cover image is included
 * @returns ComicInfo.xml content or null if metadata is empty
 */
export function generateComicInfo(
  metadata: ComicInfoV2 = {}, 
  pageCount: number = 0, 
  version: '2.0' = '2.0',  // P1-3: Always v2.0
  hasCoverImage: boolean = false  // Cover image marker
): string | null {
  try {
    // Filter fields based on version
    const versionSupport = COMICINFO_VERSION_SUPPORT[version];
    const filteredMetadata = filterMetadataByVersion(metadata, versionSupport);
    
    // Clean and validate metadata
    const cleanedMetadata = cleanUnifiedMetadata(filteredMetadata);

    // Minimum metadata contract for downstream library indexing
    if (!cleanedMetadata.Series) {
      cleanedMetadata.Series = 'Unknown Series';
    }
    if (!cleanedMetadata.LanguageISO) {
      cleanedMetadata.LanguageISO = 'und';
    }
    if (
      typeof cleanedMetadata.LanguageISO === 'string'
      && cleanedMetadata.LanguageISO.toLowerCase().startsWith('ja')
      && !cleanedMetadata.Manga
    ) {
      cleanedMetadata.Manga = 'Yes';
    }
    
    // Add pageCount if provided
    if (pageCount > 0) {
      cleanedMetadata.PageCount = pageCount;
    }

    // Add generation notes
    const currentDate = new Date();
    cleanedMetadata.Notes = cleanedMetadata.Notes || '';
    cleanedMetadata.Notes += `\nGenerated by Tako Manga Downloader (TMD) (https://github.com/oovz/Tako) on ${currentDate.toISOString()}`;
    
    // Generate version-specific XML with cover marker if needed
    return generateVersionSpecificXML(cleanedMetadata, hasCoverImage);
    
  } catch (error) {
    logger.error('Failed to generate ComicInfo.xml:', error);
    // Return null when metadata extraction fails - no fallback generation
    return null;
  }
}

/**
 * Get list of supported ComicInfo.xml fields
 * @returns Array of field information objects
 */
export function getSupportedFields(): Array<{ name: string } & ComicInfoField> {
  return Object.entries(COMICINFO_FIELDS).map(([name, info]) => ({
    name,
    ...info
  }));
}

/**
 * Validate ComicInfo field value
 * @param metadata - Metadata to validate
 * @returns Validation result
 */
export function validateComicInfo(metadata: ComicInfoV2): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  for (const [key, value] of Object.entries(metadata)) {
    if (!COMICINFO_FIELDS[key]) {
      warnings.push(`Unknown field: ${key}`);
      continue;
    }
    
    if (!validateField(key, value)) {
      errors.push(`Invalid value for field ${key}: ${value}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Check if a site integration supports metadata extraction
 * @param integration - Site integration to check
 * @returns boolean indicating if the site integration can generate meaningful metadata
 */
export function integrationSupportsMetadata(integration: unknown): boolean {
  if (!integration || typeof integration !== 'object') {
    return false;
  }
  
  const integrationObject = integration as { series?: { extractSeriesMetadata?: unknown } };
  
  // Check if the site integration has extractSeriesMetadata method
  return typeof integrationObject.series?.extractSeriesMetadata === 'function';
}

// Export field definitions for documentation
export { COMICINFO_FIELDS };

