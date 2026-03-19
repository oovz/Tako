/**
 * @file html-fixtures.ts
 * @description HTML fixtures for MangaDex route mocking
 * 
 * Simplified HTML structures for MangaDex testing
 */

import type { HTMLFixtures } from '../../types';

/**
 * Simplified series page HTML matching MangaDex structure
 */
export const SERIES_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Hunter x Hunter</title>
</head>
<body>
  <div class="container">
    <div class="manga-info">
      <h1>Hunter x Hunter</h1>
      <div class="metadata">
        <p><strong>Author:</strong> Togashi Yoshihiro</p>
        <p><strong>Artist:</strong> Togashi Yoshihiro</p>
        <p><strong>Status:</strong> Ongoing</p>
        <p><strong>Description:</strong> Hunters are a special breed, dedicated to tracking down treasures, magical beasts, and even other men. But such pursuits require a license, and less than one in a hundred thousand can pass the grueling qualification exam. Those who do pass gain access to restricted areas, amazing stores of information, and the right to call themselves Hunters.</p>
      </div>
    </div>
    
    <div class="chapters-container">
      <h4>Chapters</h4>
      <div class="chapter-list">
        <div class="chapter-row">
          <a href="https://mangadex.test/chapter/afaebc64-83df-4f11-b2b0-5ef4fcc8144c">The Day of Departure</a>
        </div>
        <div class="chapter-row">
          <a href="https://mangadex.test/chapter/8505488a-2ff1-4023-ad39-0893f1886adf">An Encounter In The Storm</a>
        </div>
        <div class="chapter-row">
          <a href="https://mangadex.test/chapter/77aeb3dc-59da-4aae-854e-709abb43c480">The Ultimate Choice</a>
        </div>
        <div class="chapter-row">
          <a href="https://mangadex.test/chapter/d9d564bc-968c-4fd6-9773-ce9d050eb1cb">Wicked Magical Vulpes</a>
        </div>
        <div class="chapter-row">
          <a href="https://mangadex.test/chapter/b3ab1347-5929-4fad-8bba-ca7bbc1f2527">The First Phase Begins: Part 1</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Minimal series page for basic testing
 */
export const MINIMAL_SERIES_PAGE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="container">
    <h1>Hunter x Hunter</h1>
    <div class="chapter-list">
      <div class="chapter-row"><a href="https://mangadex.test/chapter/afaebc64-83df-4f11-b2b0-5ef4fcc8144c">The Day of Departure</a></div>
      <div class="chapter-row"><a href="https://mangadex.test/chapter/8505488a-2ff1-4023-ad39-0893f1886adf">An Encounter In The Storm</a></div>
      <div class="chapter-row"><a href="https://mangadex.test/chapter/77aeb3dc-59da-4aae-854e-709abb43c480">The Ultimate Choice</a></div>
      <div class="chapter-row"><a href="https://mangadex.test/chapter/d9d564bc-968c-4fd6-9773-ce9d050eb1cb">Wicked Magical Vulpes</a></div>
      <div class="chapter-row"><a href="https://mangadex.test/chapter/b3ab1347-5929-4fad-8bba-ca7bbc1f2527">The First Phase Begins: Part 1</a></div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Chapter page HTML
 */
export const CHAPTER_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>The Day of Departure - MangaDex</title>
</head>
<body>
  <div class="reader">
    <h3>The Day of Departure</h3>
    <div class="page-list">
      <img src="https://mangadex.test/data/page1.jpg" alt="Page 1">
      <img src="https://mangadex.test/data/page2.jpg" alt="Page 2">
      <img src="https://mangadex.test/data/page3.jpg" alt="Page 3">
    </div>
  </div>
</body>
</html>
`;

/**
 * HTML fixtures export
 */
export const MANGADEX_HTML: HTMLFixtures = {
  seriesPageHtml: SERIES_PAGE_HTML,
  chapterPageHtml: CHAPTER_PAGE_HTML,
};

/**
 * Minimal HTML fixtures for basic tests
 */
export const MANGADEX_MINIMAL_HTML: HTMLFixtures = {
  seriesPageHtml: MINIMAL_SERIES_PAGE_HTML,
  chapterPageHtml: CHAPTER_PAGE_HTML,
};
