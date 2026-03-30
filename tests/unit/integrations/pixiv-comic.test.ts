import { afterEach, beforeEach } from 'vitest';
import { registerPixivComicBackgroundImageCases } from './pixiv-comic-background-images.cases';
import { registerPixivComicContentCases } from './pixiv-comic-content.cases';
import { registerPixivComicSeriesApiCases } from './pixiv-comic-series-api.cases';
import { cleanupPixivComicTestEnvironment, resetPixivComicTestEnvironment } from './pixiv-comic-test-setup';

beforeEach(() => {
  resetPixivComicTestEnvironment();
});

afterEach(() => {
  cleanupPixivComicTestEnvironment();
});

registerPixivComicContentCases();
registerPixivComicBackgroundImageCases();
registerPixivComicSeriesApiCases();

