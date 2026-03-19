/**
 * @file progress-calculator.test.ts
 * @description Unit tests for intelligent progress calculation
 * 
 * Tests:
 * - Startup progress (0-5%)
 * - Download progress (5-95%) with chapter/image tracking
 * - Finalization progress (95-100%)
 * - Smooth progress transitions
 * - Edge cases and boundary conditions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligentProgressCalculator } from '@/src/runtime/progress-calculator';
import type { ChapterProgressInfo } from '@/src/runtime/progress-calculator';

describe('Intelligent Progress Calculator', () => {
  let calculator: IntelligentProgressCalculator;

  beforeEach(() => {
    calculator = new IntelligentProgressCalculator();
  });

  describe('Startup Progress (0-5%)', () => {
    it('calculates initializing step progress', () => {
      const progress = calculator.calculateStartupProgress('initializing');
      expect(progress).toBe(2); // 30% of 5% = 1.5 rounded to 2
    });

    it('calculates connecting step progress', () => {
      const progress = calculator.calculateStartupProgress('connecting');
      expect(progress).toBe(4); // 70% of 5% = 3.5 rounded to 4
    });

    it('calculates ready step progress', () => {
      const progress = calculator.calculateStartupProgress('ready');
      expect(progress).toBe(5); // 100% of 5% = 5
    });

    it('startup progress increases monotonically', () => {
      const initializing = calculator.calculateStartupProgress('initializing');
      const connecting = calculator.calculateStartupProgress('connecting');
      const ready = calculator.calculateStartupProgress('ready');

      expect(connecting).toBeGreaterThan(initializing);
      expect(ready).toBeGreaterThan(connecting);
    });
  });

  describe('Download Progress (5-95%)', () => {
    it('calculates progress for first chapter fetching HTML', () => {
      const chapterInfo: ChapterProgressInfo = {
        chapterIndex: 0,
        totalChapters: 10,
        chapterPhase: 'fetching_html',
      };

      const progress = calculator.calculateDownloadProgress(chapterInfo);
      // Should be in startup to early download range
      expect(progress).toBeGreaterThanOrEqual(5);
      expect(progress).toBeLessThanOrEqual(7);
    });

    it('calculates progress for first chapter extracting URLs', () => {
      const chapterInfo: ChapterProgressInfo = {
        chapterIndex: 0,
        totalChapters: 10,
        chapterPhase: 'extracting_urls',
      };

      const progress = calculator.calculateDownloadProgress(chapterInfo);
      // 5% + (0.2 * 9% chapter weight) = 5% + 1.8%
      expect(progress).toBeGreaterThanOrEqual(6);
      expect(progress).toBeLessThan(8);
    });

    it('calculates progress for downloading images with partial completion', () => {
      const chapterInfo: ChapterProgressInfo = {
        chapterIndex: 0,
        totalChapters: 10,
        chapterPhase: 'downloading_images',
        imageIndex: 25,
        totalImages: 50,
      };

      const progress = calculator.calculateDownloadProgress(chapterInfo);
      // 5% + (0.2 + 0.5 * 0.7) * 9% = 5% + 0.55 * 9% = 5% + 4.95%
      expect(progress).toBeGreaterThanOrEqual(9);
      expect(progress).toBeLessThan(11);
    });

    it('calculates progress for creating archive', () => {
      const chapterInfo: ChapterProgressInfo = {
        chapterIndex: 0,
        totalChapters: 10,
        chapterPhase: 'creating_archive',
      };

      const progress = calculator.calculateDownloadProgress(chapterInfo);
      // 5% + 0.9 * 9% = 5% + 8.1%
      expect(progress).toBeGreaterThanOrEqual(13);
      expect(progress).toBeLessThan(15);
    });

    it('calculates progress for completed chapters', () => {
      const chapterInfo: ChapterProgressInfo = {
        chapterIndex: 5, // 5 chapters completed
        totalChapters: 10,
        chapterPhase: 'fetching_html', // Starting 6th chapter
      };

      const progress = calculator.calculateDownloadProgress(chapterInfo);
      // 5% + 5 * 9% = 5% + 45% = 50%
      expect(progress).toBeGreaterThanOrEqual(50);
      expect(progress).toBeLessThan(52);
    });

    it('calculates progress for last chapter', () => {
      const chapterInfo: ChapterProgressInfo = {
        chapterIndex: 9, // 9 completed, working on 10th
        totalChapters: 10,
        chapterPhase: 'creating_archive',
      };

      const progress = calculator.calculateDownloadProgress(chapterInfo);
      // 5% + 9 * 9% + 0.9 * 9% = 5% + 81% + 8.1% = 94.1%
      expect(progress).toBeGreaterThanOrEqual(94);
      expect(progress).toBeLessThan(96);
    });

    it('distributes progress equally across chapters', () => {
      // Test that each chapter gets equal weight
      const totalChapters = 5;
      const chapterWeight = 90 / totalChapters; // Each chapter is 18%

      for (let i = 0; i < totalChapters; i++) {
        const startProgress = calculator.calculateDownloadProgress({
          chapterIndex: i,
          totalChapters,
          chapterPhase: 'fetching_html',
        });

        const endProgress = calculator.calculateDownloadProgress({
          chapterIndex: i,
          totalChapters,
          chapterPhase: 'creating_archive',
        });

        // Progress increase for this chapter should be roughly equal to chapter weight
        const chapterProgressRange = endProgress - startProgress;
        expect(chapterProgressRange).toBeGreaterThan(chapterWeight * 0.7);
        expect(chapterProgressRange).toBeLessThan(chapterWeight * 1.3);
      }
    });

    it('handles zero images gracefully', () => {
      const chapterInfo: ChapterProgressInfo = {
        chapterIndex: 0,
        totalChapters: 1,
        chapterPhase: 'downloading_images',
        imageIndex: 0,
        totalImages: 0,
      };

      const progress = calculator.calculateDownloadProgress(chapterInfo);
      // Should fallback to 20% of chapter progress
      expect(progress).toBeGreaterThanOrEqual(5);
      expect(progress).toBeLessThan(96);
    });

    it('handles single chapter download', () => {
      const startInfo: ChapterProgressInfo = {
        chapterIndex: 0,
        totalChapters: 1,
        chapterPhase: 'fetching_html',
      };

      const endInfo: ChapterProgressInfo = {
        chapterIndex: 0,
        totalChapters: 1,
        chapterPhase: 'creating_archive',
      };

      const startProgress = calculator.calculateDownloadProgress(startInfo);
      const endProgress = calculator.calculateDownloadProgress(endInfo);

      expect(startProgress).toBeGreaterThanOrEqual(5);
      expect(endProgress).toBeLessThanOrEqual(95);
      expect(endProgress).toBeGreaterThan(startProgress);
    });

    it('handles large batch of chapters', () => {
      const totalChapters = 100;
      
      const midProgress = calculator.calculateDownloadProgress({
        chapterIndex: 50,
        totalChapters,
        chapterPhase: 'fetching_html',
      });

      // Should be roughly 50% through download phase
      expect(midProgress).toBeGreaterThanOrEqual(48);
      expect(midProgress).toBeLessThanOrEqual(52);
    });
  });

  describe('Finalization Progress (95-100%)', () => {
    it('calculates organizing step progress', () => {
      const progress = calculator.calculateFinalizationProgress('organizing');
      expect(progress).toBeGreaterThanOrEqual(96);
      expect(progress).toBeLessThanOrEqual(97);
    });

    it('calculates cleanup step progress', () => {
      const progress = calculator.calculateFinalizationProgress('cleanup');
      expect(progress).toBe(99); // 95% + 70% of 5%
    });

    it('calculates complete step progress', () => {
      const progress = calculator.calculateFinalizationProgress('complete');
      expect(progress).toBe(100); // 95% + 100% of 5%
    });

    it('finalization progress increases monotonically', () => {
      const organizing = calculator.calculateFinalizationProgress('organizing');
      const cleanup = calculator.calculateFinalizationProgress('cleanup');
      const complete = calculator.calculateFinalizationProgress('complete');

      expect(cleanup).toBeGreaterThan(organizing);
      expect(complete).toBeGreaterThan(cleanup);
    });
  });

  describe('Overall Progress API', () => {
    it('returns startup progress for startup phase', () => {
      const progress = calculator.getOverallProgress('startup', { step: 'connecting' });
      expect(progress).toBe(4);
    });

    it('returns download progress for downloading phase', () => {
      const progress = calculator.getOverallProgress('downloading', {
        chapterIndex: 2,
        totalChapters: 5,
        chapterPhase: 'downloading_images',
        imageIndex: 10,
        totalImages: 20,
      });

      // 5% + 2 * 18% + (0.2 + 0.5 * 0.7) * 18% = 5% + 36% + 9.9%
      expect(progress).toBeGreaterThanOrEqual(50);
      expect(progress).toBeLessThan(52);
    });

    it('returns finalization progress for finalizing phase', () => {
      const progress = calculator.getOverallProgress('finalizing', { step: 'cleanup' });
      expect(progress).toBe(99);
    });

    it('falls back to startup percentage for incomplete download info', () => {
      const progress = calculator.getOverallProgress('downloading', { step: 'some-step' });
      expect(progress).toBe(5);
    });

    it('defaults to initializing step when step not provided', () => {
      const progress = calculator.getOverallProgress('startup', {});
      expect(progress).toBe(2); // initializing step
    });
  });

  describe('Smooth Progress Transitions', () => {
    it('smooths progress transition with default smoothing factor', () => {
      const currentProgress = 10;
      const targetProgress = 50;

      const smoothed = calculator.calculateSmoothProgress(currentProgress, targetProgress);

      // Should move towards target but not reach it in one step
      expect(smoothed).toBeGreaterThan(currentProgress);
      expect(smoothed).toBeLessThan(targetProgress);
    });

    it('smooths progress with custom smoothing factor', () => {
      const currentProgress = 10;
      const targetProgress = 50;

      const smoothed1 = calculator.calculateSmoothProgress(currentProgress, targetProgress, 0.1);
      const smoothed2 = calculator.calculateSmoothProgress(currentProgress, targetProgress, 0.5);

      // Higher smoothing factor should result in faster transition
      expect(smoothed2).toBeGreaterThan(smoothed1);
    });

    it('returns target when difference is less than 1', () => {
      const currentProgress = 49.5;
      const targetProgress = 50;

      const smoothed = calculator.calculateSmoothProgress(currentProgress, targetProgress);

      expect(smoothed).toBe(targetProgress);
    });

    it('handles backward progress transitions', () => {
      const currentProgress = 50;
      const targetProgress = 30;

      const smoothed = calculator.calculateSmoothProgress(currentProgress, targetProgress);

      // Should move towards target (downward)
      expect(smoothed).toBeLessThan(currentProgress);
      expect(smoothed).toBeGreaterThan(targetProgress);
    });

    it('handles zero current progress', () => {
      const smoothed = calculator.calculateSmoothProgress(0, 50, 0.3);

      expect(smoothed).toBeGreaterThan(0);
      expect(smoothed).toBeLessThan(50);
    });

    it('rounds smoothed progress to integer', () => {
      const smoothed = calculator.calculateSmoothProgress(10, 50, 0.333);

      expect(Number.isInteger(smoothed)).toBe(true);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('never returns progress below 0', () => {
      const progress = calculator.calculateStartupProgress('initializing');
      expect(progress).toBeGreaterThanOrEqual(0);
    });

    it('never returns progress above 100', () => {
      const progress = calculator.calculateFinalizationProgress('complete');
      expect(progress).toBeLessThanOrEqual(100);
    });

    it('handles chapter index exceeding total chapters', () => {
      // Note: Calculator doesn't clamp invalid inputs - consumers should validate
      const progress = calculator.calculateDownloadProgress({
        chapterIndex: 15,
        totalChapters: 10,
        chapterPhase: 'fetching_html',
      });

      // This test documents current behavior - progress can exceed 100 with invalid input
      expect(progress).toBeGreaterThan(100);
    });

    it('handles negative chapter index', () => {
      // Note: Calculator doesn't clamp invalid inputs - consumers should validate
      const progress = calculator.calculateDownloadProgress({
        chapterIndex: -1,
        totalChapters: 10,
        chapterPhase: 'fetching_html',
      });

      // This test documents current behavior - progress can be negative with invalid input
      expect(progress).toBeLessThan(5);
    });

    it('handles image index exceeding total images', () => {
      const progress = calculator.calculateDownloadProgress({
        chapterIndex: 0,
        totalChapters: 1,
        chapterPhase: 'downloading_images',
        imageIndex: 60,
        totalImages: 50,
      });

      // Should cap at 100% of images (creating_archive phase equivalent)
      expect(progress).toBeGreaterThanOrEqual(5);
      expect(progress).toBeLessThanOrEqual(100);
    });
  });

  describe('Progress Consistency', () => {
    it('maintains monotonic progress through chapter phases', () => {
      const phases: Array<ChapterProgressInfo['chapterPhase']> = [
        'fetching_html',
        'extracting_urls',
        'downloading_images',
        'creating_archive',
      ];

      let previousProgress = 0;

      for (const phase of phases) {
        const progress = calculator.calculateDownloadProgress({
          chapterIndex: 0,
          totalChapters: 1,
          chapterPhase: phase,
          imageIndex: phase === 'downloading_images' ? 50 : undefined,
          totalImages: phase === 'downloading_images' ? 50 : undefined,
        });

        expect(progress).toBeGreaterThanOrEqual(previousProgress);
        previousProgress = progress;
      }
    });

    it('maintains monotonic progress through image downloading', () => {
      const totalImages = 50;
      let previousProgress = 0;

      for (let i = 0; i <= totalImages; i += 10) {
        const progress = calculator.calculateDownloadProgress({
          chapterIndex: 0,
          totalChapters: 1,
          chapterPhase: 'downloading_images',
          imageIndex: i,
          totalImages,
        });

        expect(progress).toBeGreaterThanOrEqual(previousProgress);
        previousProgress = progress;
      }
    });

    it('ensures startup -> download -> finalization progression', () => {
      const startup = calculator.calculateStartupProgress('ready');
      
      const download = calculator.calculateDownloadProgress({
        chapterIndex: 0,
        totalChapters: 1,
        chapterPhase: 'fetching_html',
      });

      const finalization = calculator.calculateFinalizationProgress('organizing');

      expect(download).toBeGreaterThanOrEqual(startup);
      expect(finalization).toBeGreaterThan(download);
    });
  });

  describe('Real-World Scenarios', () => {
    it('calculates progress for typical 10-chapter download', () => {
      // Simulate downloading 10 chapters, each with 50 images
      const totalChapters = 10;
      const imagesPerChapter = 50;

      // Chapter 5, halfway through images
      const progress = calculator.calculateDownloadProgress({
        chapterIndex: 4, // 4 completed, working on 5th
        totalChapters,
        chapterPhase: 'downloading_images',
        imageIndex: 25,
        totalImages: imagesPerChapter,
      });

      // Should be roughly 40-50% complete
      expect(progress).toBeGreaterThanOrEqual(40);
      expect(progress).toBeLessThanOrEqual(55);
    });

    it('calculates progress for large manga series (100 chapters)', () => {
      const totalChapters = 100;

      // 25 chapters done
      const progress25 = calculator.calculateDownloadProgress({
        chapterIndex: 25,
        totalChapters,
        chapterPhase: 'fetching_html',
      });

      // 50 chapters done
      const progress50 = calculator.calculateDownloadProgress({
        chapterIndex: 50,
        totalChapters,
        chapterPhase: 'fetching_html',
      });

      // 75 chapters done
      const progress75 = calculator.calculateDownloadProgress({
        chapterIndex: 75,
        totalChapters,
        chapterPhase: 'fetching_html',
      });

      // Should be roughly linear progression
      expect(progress25).toBeGreaterThanOrEqual(25);
      expect(progress25).toBeLessThanOrEqual(30);

      expect(progress50).toBeGreaterThanOrEqual(50);
      expect(progress50).toBeLessThanOrEqual(55);

      expect(progress75).toBeGreaterThanOrEqual(73);
      expect(progress75).toBeLessThanOrEqual(78);
    });

    it('simulates complete download lifecycle', () => {
      const lifecycle = [
        { phase: 'startup' as const, step: 'initializing', expected: 2 },
        { phase: 'startup' as const, step: 'connecting', expected: 4 },
        { phase: 'startup' as const, step: 'ready', expected: 5 },
        { phase: 'finalizing' as const, step: 'organizing', expectedMin: 96, expectedMax: 97 },
        { phase: 'finalizing' as const, step: 'cleanup', expected: 99 },
        { phase: 'finalizing' as const, step: 'complete', expected: 100 },
      ];

      for (const item of lifecycle) {
        const progress = calculator.getOverallProgress(item.phase, { step: item.step });
        if ('expected' in item) {
          expect(progress).toBe(item.expected);
        } else {
          expect(progress).toBeGreaterThanOrEqual(item.expectedMin);
          expect(progress).toBeLessThanOrEqual(item.expectedMax);
        }
      }
    });
  });
});

