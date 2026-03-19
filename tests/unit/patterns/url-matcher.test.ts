/**
 * @file url-matcher.test.ts
 * @description Unit tests for URL pattern matching logic
 * 
 * Tests:
 * - Basic URL pattern matching
 * - Wildcard patterns (* and **)
 * - Exclude pattern enforcement
 * - Content script match generation
 */

import { describe, it, expect, afterEach } from 'vitest';
import { matchUrl, isSupportedDomain, getContentScriptMatches } from '@/src/site-integrations/url-matcher';
import { getAllSiteIntegrationPatterns } from '@/src/site-integrations/manifest';
import { setUserSiteIntegrationEnablement } from '@/src/site-integrations/registry';

const SITE_PATTERNS = getAllSiteIntegrationPatterns();

describe('URL Pattern Matching', () => {
  afterEach(() => {
    setUserSiteIntegrationEnablement({})
  })

  describe('Basic Pattern Matching', () => {
    it('matches exact domain', () => {
      const result = matchUrl('https://comic.pixiv.net/works/9012');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('pixiv-comic');
      expect(result?.role).toBe('series');
    });

    it('matches pixiv viewer story route', () => {
      const result = matchUrl('https://comic.pixiv.net/viewer/stories/44495');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('pixiv-comic');
      expect(result?.role).toBe('series');
    });

    it('matches pixiv episode route', () => {
      const result = matchUrl('https://comic.pixiv.net/episodes/9999');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('pixiv-comic');
      expect(result?.role).toBe('series');
    });

    it('matches domain with www', () => {
      const result = matchUrl('https://www.mangadex.org/title/abc123');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('mangadex');
    });

    it('returns null for unsupported domain', () => {
      const result = matchUrl('https://unsupported-site.com/manga/123');
      expect(result).toBeNull();
    });

    it('matches shonenjumpplus episode paths', () => {
      const result = matchUrl('https://shonenjumpplus.com/episode/10834108156648240735');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('shonenjumpplus');
      expect(result?.role).toBe('series');
    });

    it('matches mangadex series pages', () => {
      const result = matchUrl('https://mangadex.org/title/abc123');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('mangadex');
      expect(result?.role).toBe('series');
    });

    it('does not match a user-disabled integration', () => {
      setUserSiteIntegrationEnablement({ mangadex: false })

      const result = matchUrl('https://mangadex.org/title/abc123');
      expect(result).toBeNull();
    });
  });

  describe('Wildcard Pattern Matching', () => {
    it('matches single wildcard (*) for one segment', () => {
      // /episode/* should match /episode/123
      const result1 = matchUrl('https://shonenjumpplus.com/episode/123');
      expect(result1).toBeDefined();
      expect(result1?.integrationId).toBe('shonenjumpplus');
    });

    it('does not match non-MVP domains with wildcards (e.g., e-hentai)', () => {
      const result = matchUrl('https://e-hentai.org/g/12345/test-token');
      expect(result).toBeNull();
    });
  });

  describe('Exclude Pattern Enforcement', () => {
    it('excludes unsupported chapter paths', () => {
      const result = matchUrl('https://mangadex.org/chapter/98765');
      expect(result).toBeNull();
    });

    it('does not match manganelo domain (MVP scope)', () => {
      const result = matchUrl('https://chapmanganato.to/manga-test/chapter-1');
      expect(result).toBeNull();
    });

    it('allows title paths (mangadex series pages)', () => {
      const result = matchUrl('https://mangadex.org/title/12345-test-manga');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('mangadex');
    });

    it('allows series pages', () => {
      const result = matchUrl('https://comic.pixiv.net/works/9012');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('pixiv-comic');
    });
  });

  describe('Path-Specific Matching', () => {
    it('returns null for homepage', () => {
      const result = matchUrl('https://mangadex.org/');
      expect(result).toBeNull();
    });

    it('matches series page paths', () => {
      const result = matchUrl('https://comic.pixiv.net/works/123');
      expect(result).toBeDefined();
      expect(result?.role).toBe('series');
    });
  });

  describe('Domain Support Check', () => {
    it('returns true for supported domains (domain-only check)', () => {
      expect(isSupportedDomain('https://comic.pixiv.net/works/123')).toBe(true);
      // still true for same domain with different paths
      expect(isSupportedDomain('https://mangadex.org/anything')).toBe(true);
    });

    it('returns false for unsupported or non-MVP domains', () => {
      expect(isSupportedDomain('https://mangadex.org/title/abc')).toBe(true);
      expect(isSupportedDomain('https://unsupported.com/manga/123')).toBe(false);
      expect(isSupportedDomain('https://google.com')).toBe(false);
    });
  });

  describe('Content Script Matches', () => {
    it('generates matches for all supported site integrations', () => {
      const matches = getContentScriptMatches();
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.includes('comic.pixiv.net'))).toBe(true);
      expect(matches.some(m => m.includes('mangadex.org'))).toBe(true);
    });

    it('generates unique matches (no duplicates)', () => {
      const matches = getContentScriptMatches();
      const uniqueMatches = new Set(matches);
      
      expect(matches.length).toBe(uniqueMatches.size);
    });
  });

  describe('Edge Cases', () => {
    it('handles URL with query parameters', () => {
      const result = matchUrl('https://mangadex.org/title/123?page=2');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('mangadex');
    });

    it('handles URL with hash fragment', () => {
      const result = matchUrl('https://mangadex.org/title/123#comments');
      expect(result).toBeDefined();
      expect(result?.integrationId).toBe('mangadex');
    });

    it('handles URL with port number', () => {
      const result = matchUrl('https://mangadex.org:443/title/123');
      expect(result).toBeDefined();
    });

    it('handles malformed URLs gracefully', () => {
      const result = matchUrl('not-a-valid-url');
      expect(result).toBeNull();
    });

    it('handles empty path', () => {
      const result = matchUrl('https://mangadex.org');
      expect(result).toBeNull(); // Homepage doesn't match series patterns
    });

    it('handles trailing slashes consistently', () => {
      const result1 = matchUrl('https://mangadex.org/title/123');
      const result2 = matchUrl('https://mangadex.org/title/123/');
      
      // Both should match or both should not match
      expect(result1?.integrationId).toBe(result2?.integrationId);
    });
  });

  describe('Pattern Data Integrity', () => {
    it('all patterns have required fields', () => {
      Object.entries(SITE_PATTERNS).forEach(([_integrationId, pattern]) => {
        expect(pattern.domains).toBeDefined();
        expect(Array.isArray(pattern.domains)).toBe(true);
        expect(pattern.domains.length).toBeGreaterThan(0);
        
        expect(pattern.seriesMatches).toBeDefined();
        expect(Array.isArray(pattern.seriesMatches)).toBe(true);
        
        // excludeMatches is optional but should be array if present
        if ('excludeMatches' in pattern) {
          expect(Array.isArray(pattern.excludeMatches)).toBe(true);
        }
      });
    });

    it('allows shared domains with different path patterns', () => {
      const allDomains = new Map<string, string[]>();
      
      Object.entries(SITE_PATTERNS).forEach(([integrationId, pattern]) => {
        pattern.domains.forEach(domain => {
          if (!allDomains.has(domain)) {
            allDomains.set(domain, []);
          }
          allDomains.get(domain)!.push(integrationId);
        });
      });
      
      // Shared domains are allowed if they use different path patterns
      allDomains.forEach((integrationIds, _domain) => {
        if (integrationIds.length > 1) {
          // Verify they have different seriesMatches patterns
          const patterns = integrationIds.map(id => SITE_PATTERNS[id as keyof typeof SITE_PATTERNS].seriesMatches);
          const uniquePatterns = new Set(patterns.map(p => JSON.stringify(p)));
          expect(uniquePatterns.size).toBe(integrationIds.length);
        }
      });
    });

    it('seriesMatches patterns are valid', () => {
      Object.entries(SITE_PATTERNS).forEach(([_integrationId, pattern]) => {
        pattern.seriesMatches.forEach(match => {
          expect(typeof match).toBe('string');
          expect(match.length).toBeGreaterThan(0);
          expect(match.startsWith('/')).toBe(true);
        });
      });
    });
  });
});

