import { beforeEach } from 'vitest';
import { registerShonenJumpPlusBackgroundImageCases } from './shonenjumpplus-background-images.cases';
import { registerShonenJumpPlusChapterListCases } from './shonenjumpplus-chapter-list.cases';
import { registerShonenJumpPlusMetadataCases } from './shonenjumpplus-metadata.cases';
import { resetShonenJumpPlusTestEnvironment } from './shonenjumpplus-test-setup';

beforeEach(() => {
  resetShonenJumpPlusTestEnvironment();
});

registerShonenJumpPlusMetadataCases();
registerShonenJumpPlusBackgroundImageCases();
registerShonenJumpPlusChapterListCases();

