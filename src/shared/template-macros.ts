/**
 * Single source of truth for download path template macros
 * Defines all supported macros with their descriptions and capabilities
 */

export interface TemplateMacro {
  name: string;
  description: string;
  example: string;
  requiresMangaMetadata: boolean;
  category: 'date' | 'manga' | 'site';
}

/**
 * Definitive list of all supported template macros
 */
export const TEMPLATE_MACROS: readonly TemplateMacro[] = [
  // Date macros - can be resolved anywhere
  {
    name: 'YYYY',
    description: 'Current year (4 digits)',
    example: '2025',
    requiresMangaMetadata: false,
    category: 'date'
  },
  {
    name: 'MM',
    description: 'Current month (2 digits, zero-padded)',
    example: '09',
    requiresMangaMetadata: false,
    category: 'date'
  },
  {
    name: 'DD',
    description: 'Current day (2 digits, zero-padded)',
    example: '07',
    requiresMangaMetadata: false,
    category: 'date'
  },

  // Site macros - require site context
  {
    name: 'PUBLISHER',
    description: 'Manga publisher name',
    example: 'Weekly Shonen Jump',
    requiresMangaMetadata: true,
    category: 'site'
  },
  {
    name: 'INTEGRATION_NAME',
    description: 'Site integration name',
    example: 'mangadex',
    requiresMangaMetadata: false,
    category: 'site'
  },

  // Manga macros - require manga metadata
  {
    name: 'SERIES_TITLE',
    description: 'Manga series title',
    example: 'Hunter x Hunter',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  {
    name: 'CHAPTER_TITLE',
    description: 'Chapter title',
    example: 'Chapter 1',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  // Raw numeric values
  {
    name: 'CHAPTER_NUMBER',
    description: 'Raw chapter number (may be decimal like 15.5)',
    example: '15.5',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  {
    name: 'VOLUME_NUMBER',
    description: 'Raw volume number',
    example: '5',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  // Padded numeric values
  {
    name: 'CHAPTER_NUMBER_PAD2',
    description: 'Chapter number padded to 2 digits (falls back to raw number)',
    example: '01',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  {
    name: 'CHAPTER_NUMBER_PAD3',
    description: 'Chapter number padded to 3 digits (falls back to raw number)',
    example: '001',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  {
    name: 'VOLUME_NUMBER_PAD2',
    description: 'Volume number padded to 2 digits (falls back to raw number)',
    example: '01',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  {
    name: 'VOLUME_TITLE',
    description: 'Volume title',
    example: 'Volume 1',
    requiresMangaMetadata: true,
    category: 'manga'
  },
  // Index macros (always available - 1-indexed position in download queue)
  {
    name: 'CHAPTER_INDEX',
    description: '1-indexed position in download queue (always available)',
    example: '1',
    requiresMangaMetadata: false,
    category: 'manga'
  },
  {
    name: 'CHAPTER_INDEX_PAD2',
    description: '1-indexed position padded to 2 digits (always available)',
    example: '01',
    requiresMangaMetadata: false,
    category: 'manga'
  },
  {
    name: 'CHAPTER_INDEX_PAD3',
    description: '1-indexed position padded to 3 digits (always available)',
    example: '001',
    requiresMangaMetadata: false,
    category: 'manga'
  },
  // Language macro
  {
    name: 'LANGUAGE',
    description: 'Chapter language (BCP 47 code)',
    example: 'en',
    requiresMangaMetadata: true,
    category: 'manga'
  }
] as const;

export type TemplateMacroName = (typeof TEMPLATE_MACROS)[number]['name'];

/**
 * Get all macro names as array
 */
export function getSupportedMacroNames(): TemplateMacroName[] {
  return TEMPLATE_MACROS.map(macro => macro.name);
}

/**
 * Check if a macro name is supported
 */
export function isSupportedMacro(macroName: string): boolean {
  return getSupportedMacroNames().includes(macroName);
}

/**
 * Get macro information by name
 */
export function getMacroInfo(macroName: string): TemplateMacro | undefined {
  return TEMPLATE_MACROS.find(macro => macro.name === macroName);
}

/**
 * Get macros grouped by category
 */
export function getMacrosByCategory(): Record<string, TemplateMacro[]> {
  const grouped: Record<string, TemplateMacro[]> = {};
  
  for (const macro of TEMPLATE_MACROS) {
    if (!grouped[macro.category]) {
      grouped[macro.category] = [];
    }
    grouped[macro.category].push(macro);
  }
  
  return grouped;
}

/**
 * Generate sample data for template preview
 */
export function generateSampleMacroData(): Record<TemplateMacroName, string> {
  const sampleData = {} as Record<TemplateMacroName, string>;
  
  for (const macro of TEMPLATE_MACROS) {
    sampleData[macro.name] = macro.example;
  }
  
  return sampleData;
}

/**
 * Validate that a template only uses supported macros
 */
export function validateTemplateMacros(template: string): {
  isValid: boolean;
  invalidMacros: string[];
  error?: string;
} {
  const macroPattern = /<([^>]+)>/g;
  const usedMacros = [...template.matchAll(macroPattern)].map(match => match[1]);
  const supportedMacros = getSupportedMacroNames();
  
  const invalidMacros = usedMacros.filter(macro => !supportedMacros.includes(macro));
  
  if (invalidMacros.length > 0) {
    return {
      isValid: false,
      invalidMacros,
      error: `Unknown macros: ${invalidMacros.map(m => `<${m}>`).join(', ')}. ` +
             `Valid macros: ${supportedMacros.map(m => `<${m}>`).join(', ')}`
    };
  }
  
  return {
    isValid: true,
    invalidMacros: []
  };
}
