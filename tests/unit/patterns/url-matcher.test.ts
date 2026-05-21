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
import { setUserSiteIntegrationEnablement } from '@/src/site-integrations/registry';

function expectMatchedUrl(url: string, expected: { integrationId: string; role?: string }) {
  expect(matchUrl(url)).toMatchObject(expected);
}

describe('URL Pattern Matching', () => {
  afterEach(() => {
    setUserSiteIntegrationEnablement({})
  })

  describe('Basic Pattern Matching', () => {
    it('matches exact domain', () => {
      expectMatchedUrl('https://comic.pixiv.net/works/9012', {
        integrationId: 'pixiv-comic',
        role: 'series',
      });
    });

    it('matches pixiv viewer story route', () => {
      expectMatchedUrl('https://comic.pixiv.net/viewer/stories/44495', {
        integrationId: 'pixiv-comic',
        role: 'series',
      });
    });

    it('matches pixiv episode route', () => {
      expectMatchedUrl('https://comic.pixiv.net/episodes/9999', {
        integrationId: 'pixiv-comic',
        role: 'series',
      });
    });

    it('matches domain with www', () => {
      expectMatchedUrl('https://www.mangadex.org/title/abc123', {
        integrationId: 'mangadex',
      });
    });

    it('returns null for unsupported domain', () => {
      const result = matchUrl('https://unsupported-site.com/manga/123');
      expect(result).toBeNull();
    });

    it('matches shonenjumpplus episode paths', () => {
      expectMatchedUrl('https://shonenjumpplus.com/episode/10834108156648240735', {
        integrationId: 'shonenjumpplus',
        role: 'series',
      });
    });

    it('matches manhuagui series pages', () => {
      expectMatchedUrl('https://www.manhuagui.com/comic/28004/', {
        integrationId: 'manhuagui',
        role: 'series',
      });
    });

    it('matches mangadex series pages', () => {
      expectMatchedUrl('https://mangadex.org/title/abc123', {
        integrationId: 'mangadex',
        role: 'series',
      });
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
      expectMatchedUrl('https://shonenjumpplus.com/episode/123', {
        integrationId: 'shonenjumpplus',
      });
    });

    it('does not match unsupported domains with wildcards (e.g., e-hentai)', () => {
      const result = matchUrl('https://e-hentai.org/g/12345/test-token');
      expect(result).toBeNull();
    });
  });

  describe('Exclude Pattern Enforcement', () => {
    it('excludes unsupported chapter paths', () => {
      const result = matchUrl('https://mangadex.org/chapter/98765');
      expect(result).toBeNull();
    });

    it('excludes manhuagui chapter viewer pages', () => {
      expect(matchUrl('https://www.manhuagui.com/comic/28004/760110.html')).toBeNull();
      expect(matchUrl('https://www.manhuagui.com/comic/28004/760110_p7.html')).toBeNull();
    });

it('does not match manganelo domain (unsupported scope)', () => {
      const result = matchUrl('https://chapmanganato.to/manga-test/chapter-1');
      expect(result).toBeNull();
    });

    it('allows title paths (mangadex series pages)', () => {
      expectMatchedUrl('https://mangadex.org/title/12345-test-manga', {
        integrationId: 'mangadex',
      });
    });

    it('allows series pages', () => {
      expectMatchedUrl('https://comic.pixiv.net/works/9012', {
        integrationId: 'pixiv-comic',
      });
    });
  });

  describe('Path-Specific Matching', () => {
    it('returns null for homepage', () => {
      const result = matchUrl('https://mangadex.org/');
      expect(result).toBeNull();
    });

    it('matches series page paths', () => {
      expectMatchedUrl('https://comic.pixiv.net/works/123', {
        integrationId: 'pixiv-comic',
        role: 'series',
      });
    });
  });

  describe('Domain Support Check', () => {
    it('returns true for supported domains (domain-only check)', () => {
      expect(isSupportedDomain('https://comic.pixiv.net/works/123')).toBe(true);
      // still true for same domain with different paths
      expect(isSupportedDomain('https://mangadex.org/anything')).toBe(true);
    });

    it('returns false for unsupported domains', () => {
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
      expect(matches.some(m => m.includes('www.manhuagui.com'))).toBe(true);
    });

    it('generates unique matches (no duplicates)', () => {
      const matches = getContentScriptMatches();
      const uniqueMatches = new Set(matches);
      
      expect(matches.length).toBe(uniqueMatches.size);
    });
  });

  describe('Edge Cases', () => {
    it('handles URL with query parameters', () => {
      expectMatchedUrl('https://mangadex.org/title/123?page=2', {
        integrationId: 'mangadex',
      });
    });

    it('handles URL with hash fragment', () => {
      expectMatchedUrl('https://mangadex.org/title/123#comments', {
        integrationId: 'mangadex',
      });
    });

    it('handles URL with port number', () => {
      expectMatchedUrl('https://mangadex.org:443/title/123', {
        integrationId: 'mangadex',
      });
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

});

