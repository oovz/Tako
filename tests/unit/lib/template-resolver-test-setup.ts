import type { TemplateContext } from '@/src/shared/template-resolver';

export const baseDirectoryContext: TemplateContext = {
  date: new Date('2024-03-15T10:30:00Z'),
  publisher: 'Weekly Shonen Jump',
  integrationName: 'mangadex.org',
  seriesTitle: 'One Piece',
  chapterTitle: 'Chapter 1001 - Big Moms Rage',
  volumeTitle: 'Volume 99',
  format: 'cbz',
  chapterNumber: 1001,
  volumeNumber: 99,
};

export const baseFileContext: TemplateContext = {
  date: new Date('2024-03-15'),
  seriesTitle: 'One Piece',
  chapterTitle: 'Chapter 1001 - Big Moms Rage',
  format: 'cbz',
  chapterNumber: 1001,
};

export const baseEdgeContext: TemplateContext = {
  date: new Date('2024-03-15'),
  chapterTitle: 'Chapter 1',
  format: 'cbz',
};
