/**
 * Content Scraper - Dynamic Content & API Handling
 * 
 * This module handles:
 * 1. Static HTML parsing
 * 2. Dynamic JavaScript content loading
 * 3. API endpoint discovery and interaction
 * 4. DOM mutation observation
 * 5. Page interaction simulation
 */

import type { Chapter } from '@/src/types/chapter';
import logger from '@/src/runtime/logger';

export interface ScrapingStrategy {
  name: string;
  priority: number;
  canHandle(url: string, html?: string): boolean;
  execute(context: ScrapingContext): Promise<ScrapingResult>;
}

export interface ScrapingContext {
  url: string;
  tabId: number;
  html?: string;
  siteId: string;
  chapterInfo?: Chapter; // optional enriched chapter context
  timeoutMs?: number;
}

export interface ScrapingResult {
  success: boolean;
  imageUrls: string[];
  metadata?: {
    totalPages?: number;
    title?: string;
  apiEndpoint?: string;
    dynamicLoading?: boolean;
  };
  error?: string;
  strategy: string;
}

/**
 * Strategy 1: Static HTML Parsing (fastest, works for basic sites)
 */
export class StaticHTMLStrategy implements ScrapingStrategy {
  name = 'Static HTML Parsing';
  priority = 1;

  canHandle(url: string, html?: string): boolean {
    // Check if HTML contains static image arrays or direct image tags
    if (!html) return false;
    
    return html.includes('const imgHttps =') || 
           html.includes('var imgHttps =') ||
           html.includes('images = [') ||
           html.includes('<img') ||
           html.includes('data-src');
  }

  execute(context: ScrapingContext): Promise<ScrapingResult> {
  logger.info('🔍 Executing Static HTML strategy');
    
    if (!context.html) {
      return Promise.resolve({
        success: false,
        imageUrls: [],
        error: 'No HTML content provided',
        strategy: this.name
      });
    }

    const imageUrls = this.extractFromHTML(context.html);
    
    return Promise.resolve({
      success: imageUrls.length > 0,
      imageUrls,
      metadata: {
        totalPages: imageUrls.length,
        dynamicLoading: false
      },
      strategy: this.name
    });
  }

  private extractFromHTML(html: string): string[] {
    const urls: string[] = [];
    
    // Method 1: Extract from JavaScript variables
    const jsArrayMatch = html.match(/(?:const|var|let)\s+imgHttps\s*=\s*(\[.*?\]);/s);
    if (jsArrayMatch) {
      try {
        const parsed = JSON.parse(jsArrayMatch[1]) as Array<unknown>;
        if (Array.isArray(parsed)) {
          urls.push(...parsed.filter((url): url is string => typeof url === 'string'));
        }
      } catch (error) {
        logger.warn('⚠️ Failed to parse JavaScript image array:', error);
      }
    }
    
    // Method 2: Extract from img tags with data-src
    const dataSrcMatches = html.matchAll(/<img[^>]+data-src="([^"]+)"/g);
    for (const match of dataSrcMatches) {
      urls.push(match[1]);
    }
    
    // Method 3: Extract from img tags with src
    const srcMatches = html.matchAll(/<img[^>]+src="([^"]+)"/g);
    for (const match of srcMatches) {
      urls.push(match[1]);
    }
    
    return [...new Set(urls)]; // Remove duplicates
  }
}

function injectedPageAnalyzer(timeoutMs: number): Promise<{
  imageUrls: string[];
  apiEndpoint?: string;
  metadata?: { totalPages?: number; title?: string; apiEndpoint?: string; dynamicLoading?: boolean };
}> {
  return new Promise((resolve) => {
    const results = {
      imageUrls: [] as string[],
      apiEndpoint: undefined as string | undefined,
      metadata: {}
    };

    // Strategy 2.1: Monitor network requests for image API calls
    const originalFetch = window.fetch.bind(window);
    
    const networkRequests: string[] = [];
    
    // Intercept fetch calls
    window.fetch = function(input, init?) {
      const url = typeof input === 'string' ? input :
                 input instanceof Request ? input.url :
                 input instanceof URL ? input.toString() : String(input);
      networkRequests.push(url);
// Note: runs in page context; cannot access logger here safely
      return originalFetch(input, init);
    };
    
    // Strategy 2.2: Wait for dynamic content to load
    const checkForImages = () => {
      const imageUrls = new Set<string>();
      
      // Check all img tags
      document.querySelectorAll('img').forEach(img => {
        if (img.src) imageUrls.add(img.src);
        if (img.dataset.src) imageUrls.add(img.dataset.src);
      });
      
      // Check for lazy loading containers
      document.querySelectorAll('[data-src], [data-lazy], .lazy-image').forEach(el => {
        const src = el.getAttribute('data-src') || el.getAttribute('src');
        if (src) imageUrls.add(src);
      });
      
      // Look for image URLs in script tags or variables
      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
        const content = script.textContent || '';
        const imageMatches = content.match(/https?:\/\/[^"\s]+\.(?:jpg|jpeg|png|gif|webp)/gi);
        if (imageMatches) {
          imageMatches.forEach(url => imageUrls.add(url));
        }
      });
      
      return Array.from(imageUrls);
    };

    // Strategy 2.3: Trigger potential loading mechanisms
    const triggerLoading = () => {
      // Scroll to bottom to trigger lazy loading
      window.scrollTo(0, document.body.scrollHeight);
      
      // Click potential "load more" buttons
      const loadButtons = document.querySelectorAll(
        'button[class*="load"], button[class*="more"], .load-more, .next-page, [data-load]'
      );
      loadButtons.forEach(btn => {
        if (btn instanceof HTMLElement) {
          btn.click();
        }
      });
      
      // Trigger potential hover/focus events
      const containers = document.querySelectorAll('.chapter-container, .manga-reader, .image-container');
      containers.forEach(container => {
        container.dispatchEvent(new Event('mouseenter'));
        container.dispatchEvent(new Event('focus'));
      });
    };

    // Initial check
    let lastImageCount = 0;
    const checkInterval = setInterval(() => {
      triggerLoading();
      const currentImages = checkForImages();
      
      if (currentImages.length > lastImageCount) {
        lastImageCount = currentImages.length;
        results.imageUrls = currentImages;
      }
    }, 1000);

    // Final check and cleanup
    setTimeout(() => {
      clearInterval(checkInterval);
      
      // Restore original functions
      window.fetch = originalFetch;
      
      // Analyze network requests for API endpoints
      const imageApiRequests = networkRequests.filter(url => 
        url.includes('image') || url.includes('page') || url.includes('chapter')
      );
      
      if (imageApiRequests.length > 0) {
        results.apiEndpoint = imageApiRequests[0];
      }
      
      resolve(results);
    }, timeoutMs);
  });
}

/**
 * Strategy 2: Dynamic JavaScript Execution (content script injection)
 */
export class DynamicJavaScriptStrategy implements ScrapingStrategy {
  name = 'Dynamic JavaScript Execution';
  priority = 2;

  private static readonly DEFAULT_TIMEOUT_MS = 10000;

  canHandle(url: string, html?: string): boolean {
    // Check for indicators of dynamic loading
    if (!html) return true; // Always try if no HTML
    
    return html.includes('fetch(') ||
           html.includes('XMLHttpRequest') ||
           html.includes('axios') ||
           html.includes('addEventListener') ||
           html.includes('setTimeout') ||
           html.includes('onload');
  }

  async execute(context: ScrapingContext): Promise<ScrapingResult> {
  logger.info('🔄 Executing Dynamic JavaScript strategy');
    
    try {
      // Inject content script to interact with page
      type PageAnalyzerResult = {
        imageUrls: string[];
        apiEndpoint?: string;
        metadata?: { totalPages?: number; title?: string; apiEndpoint?: string; dynamicLoading?: boolean };
      };
      const result = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: injectedPageAnalyzer,
        args: [context.timeoutMs || DynamicJavaScriptStrategy.DEFAULT_TIMEOUT_MS]
      }) as chrome.scripting.InjectionResult<PageAnalyzerResult>[];

      const firstResult = result[0]?.result;
      if (firstResult) {
        const data = firstResult;
        return {
          success: data.imageUrls.length > 0,
          imageUrls: data.imageUrls,
          metadata: {
            totalPages: data.imageUrls.length,
            dynamicLoading: true,
            apiEndpoint: data.apiEndpoint
          },
          strategy: this.name
        };
      }

      return {
        success: false,
        imageUrls: [],
        error: 'Content script execution failed',
        strategy: this.name
      };

    } catch (error) {
      logger.error('❌ Dynamic JavaScript strategy failed:', error);
      return {
        success: false,
        imageUrls: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        strategy: this.name
      };
    }
  }

}

/**
 * Content Scraper Coordinator
 */
export class ContentScraper {
  private strategies: ScrapingStrategy[] = [
    new StaticHTMLStrategy(),
  new DynamicJavaScriptStrategy()
  ];

  async scrapeChapter(context: ScrapingContext): Promise<ScrapingResult> {
  logger.info(`🔍 Starting content scraping for: ${context.url}`);
    
    // Sort strategies by priority
    const sortedStrategies = this.strategies.sort((a, b) => a.priority - b.priority);
    
    for (const strategy of sortedStrategies) {
      if (strategy.canHandle(context.url, context.html)) {
  logger.info(`📋 Trying strategy: ${strategy.name}`);
        
        try {
          const result = await strategy.execute(context);
          
          if (result.success && result.imageUrls.length > 0) {
            logger.info(`✅ Strategy ${strategy.name} succeeded with ${result.imageUrls.length} images`);
            return result;
          } else {
            logger.warn(`⚠️ Strategy ${strategy.name} failed or found no images`);
          }
        } catch (error) {
          logger.error(`❌ Strategy ${strategy.name} threw error:`, error);
        }
      }
    }
    
    return {
      success: false,
      imageUrls: [],
      error: 'All scraping strategies failed',
      strategy: 'None'
    };
  }

  addStrategy(strategy: ScrapingStrategy): void {
    this.strategies.push(strategy);
  }

  removeStrategy(name: string): void {
    this.strategies = this.strategies.filter(s => s.name !== name);
  }
}

