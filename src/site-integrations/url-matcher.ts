/**
 * Unified URL Matcher - Context-Agnostic URL Pattern Matching
 * 
 * This module provides URL matching functionality that works consistently
 * across all extension contexts: popup, content scripts, background/service workers,
 * and offscreen documents.
 * 
 * Features:
 * - Pure function with no side effects or dependencies
 * - O(1) domain filtering for performance
 * - Supports multiple site integrations per domain
 * - Works in service worker context (no DOM access)
 */

import {
  generateContentScriptExcludeMatches,
  generateContentScriptMatches,
  getAllSiteIntegrationPatterns,
  type SiteIntegrationId,
} from '../site-integrations/manifest';
import { isEnabled } from '../site-integrations/registry';

// Get patterns from manifest SSOT
const SITE_PATTERNS = getAllSiteIntegrationPatterns();
type SitePatternId = SiteIntegrationId;

export interface UrlMatchResult {
  integrationId: SitePatternId;
  role: 'series';
}

interface CompiledPattern {
  integrationId: SitePatternId;
  domains: string[];
  seriesRegex: RegExp[];
  excludeRegex: RegExp[]; // Pre-compiled exclude patterns for performance
}

// Compiled patterns cache for performance
let compiledPatterns: CompiledPattern[] | null = null;

/**
 * Convert glob pattern to RegExp
 * Supports wildcards (*) in path patterns
 */
function pathPatternToRegex(pattern: string): RegExp {
  // Escape special regex characters except *
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Convert * to .*
  const withWildcards = escaped.replace(/\*/g, '.*');
  // Match the path part of URL (after domain)
  return new RegExp('^' + withWildcards + '$');
}

/**
 * Compile patterns for fast matching
 * Pre-compiles both series and exclude patterns for optimal performance
 */
function compilePatterns(): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  
  for (const [integrationId, patterns] of Object.entries(SITE_PATTERNS)) {
    compiled.push({
      integrationId,
      domains: patterns.domains,
      seriesRegex: patterns.seriesMatches.map(pathPatternToRegex),
      excludeRegex: (patterns.excludeMatches ?? []).map(pathPatternToRegex)
    });
  }
  
  return compiled;
}

/**
 * Initialize compiled patterns (lazy initialization)
 */
function ensurePatternsCompiled(): CompiledPattern[] {
  if (!compiledPatterns) {
    compiledPatterns = compilePatterns();
  }
  return compiledPatterns;
}

/**
 * Check if hostname matches any of the target domains
 */
function isDomainMatch(hostname: string, domains: string[]): boolean {
  for (const domain of domains) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return true;
    }
  }
  return false;
}

/**
 * Test URL path against regex patterns
 */
function testPatterns(pathname: string, patterns: RegExp[]): boolean {
  return patterns.some(regex => regex.test(pathname));
}

/**
 * Match a URL against registered site integration patterns
 * Only matches series pages (chapter matching removed per architecture simplification)
 * 
 * @param url - Full URL to match
 * @returns Match result with site integration ID and role, or null if no match
 */
export function matchUrl(url: string): UrlMatchResult | null {
  // Parse URL safely
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  
  const hostname = parsedUrl.hostname;
  let pathname = parsedUrl.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '');
  }
  
  // Get compiled patterns
  const patterns = ensurePatternsCompiled();
  
  // Filter candidates by domain (O(1) domain filtering)
  const candidates = patterns.filter(pattern => 
    isDomainMatch(hostname, pattern.domains)
  );
  
  if (candidates.length === 0) {
    return null;
  }
  
  // Test each candidate site integration for series pages
  for (const candidate of candidates) {
    if (!isEnabled(candidate.integrationId)) {
      continue;
    }

    if (testPatterns(pathname, candidate.seriesRegex)) {
      // Check pre-compiled exclude patterns (FAST - no regex compilation)
      if (candidate.excludeRegex.length > 0 && testPatterns(pathname, candidate.excludeRegex)) {
        continue; // Skip this match, it's excluded
      }
      
      return {
        integrationId: candidate.integrationId,
        role: 'series'
      };
    }
  }
  
  return null;
}

/**
 * Check if a domain is supported by any site integration
 */
export function isSupportedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    const patterns = ensurePatternsCompiled();
    
    return patterns.some(pattern => 
      isDomainMatch(hostname, pattern.domains)
    );
  } catch {
    return false;
  }
}

/**
 * Get all content script match patterns for manifest
 * Generates path-specific patterns for series pages only (e.g., *://mangadex.org/title/*)
 */
export function getContentScriptMatches(): string[] {
  return generateContentScriptMatches();
}

/**
 * Get all content script exclude_matches patterns for manifest
 * Generates path-specific exclusion patterns to exclude deeper paths like chapters
 */
export function getContentScriptExcludeMatches(): string[] {
  return generateContentScriptExcludeMatches();
}

/**
 * Get all pattern metadata (for options/popup display)
 */
export function getAllPatternMetadata() {
  return Object.entries(SITE_PATTERNS).map(([integrationId, patterns]) => ({
    integrationId,
    domains: patterns.domains,
    seriesMatches: patterns.seriesMatches.map(path => `*://*${path}`)
  }));
}

/**
 * Reset compiled patterns cache (for testing)
 */
export function resetPatternsCache(): void {
  compiledPatterns = null;
}
