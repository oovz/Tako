/**
 * Intelligent Progress Calculator
 * 
 * Implements 5% startup + 95% distributed across chapters
 * Provides accurate, smooth progress tracking for downloads
 */

export interface ProgressPhase {
  name: 'startup' | 'downloading' | 'finalizing';
  basePercentage: number;
  weight: number;
}

export interface ChapterProgressInfo {
  chapterIndex: number;
  totalChapters: number;
  chapterPhase: 'fetching_html' | 'extracting_urls' | 'downloading_images' | 'creating_archive';
  imageIndex?: number;
  totalImages?: number;
}

export class IntelligentProgressCalculator {
  private readonly STARTUP_PERCENTAGE = 5;
  private readonly DOWNLOAD_PERCENTAGE = 90;
  private readonly FINALIZATION_PERCENTAGE = 5;
  
  private readonly phases: ProgressPhase[] = [
    { name: 'startup', basePercentage: 0, weight: this.STARTUP_PERCENTAGE },
    { name: 'downloading', basePercentage: this.STARTUP_PERCENTAGE, weight: this.DOWNLOAD_PERCENTAGE },
    { name: 'finalizing', basePercentage: this.STARTUP_PERCENTAGE + this.DOWNLOAD_PERCENTAGE, weight: this.FINALIZATION_PERCENTAGE }
  ];

  /**
   * Calculate startup progress (0-5%)
   */
  calculateStartupProgress(step: 'initializing' | 'connecting' | 'ready'): number {
    const stepProgress = {
      initializing: 30,  // 30% of startup
      connecting: 70,    // 70% of startup  
      ready: 100         // 100% of startup
    };
    
    return Math.round((stepProgress[step] / 100) * this.STARTUP_PERCENTAGE);
  }

  /**
   * Calculate download progress (5-95%)
   */
  calculateDownloadProgress(chapterInfo: ChapterProgressInfo): number {
    const { chapterIndex, totalChapters, chapterPhase, imageIndex = 0, totalImages = 0 } = chapterInfo;
    
    // Each chapter gets equal portion of the 90% download allocation
    const chapterWeight = this.DOWNLOAD_PERCENTAGE / totalChapters;
    const completedChaptersProgress = chapterIndex * chapterWeight;
    
    // Current chapter progress within its allocation
    let currentChapterProgress = 0;
    
    switch (chapterPhase) {
      case 'fetching_html':
        currentChapterProgress = 0.1; // 10% of chapter
        break;
        
      case 'extracting_urls':
        currentChapterProgress = 0.2; // 20% of chapter
        break;
        
      case 'downloading_images':
        if (totalImages > 0) {
          // 20% -> 90% of chapter (70% range for image downloading)
          const imageProgress = imageIndex / totalImages;
          currentChapterProgress = 0.2 + (imageProgress * 0.7);
        } else {
          currentChapterProgress = 0.2;
        }
        break;
        
      case 'creating_archive':
        currentChapterProgress = 0.9; // 90% of chapter
        break;
    }
    
    const currentChapterContribution = currentChapterProgress * chapterWeight;
    const totalDownloadProgress = completedChaptersProgress + currentChapterContribution;
    
    return Math.round(this.STARTUP_PERCENTAGE + totalDownloadProgress);
  }

  /**
   * Calculate finalization progress (95-100%)
   */
  calculateFinalizationProgress(step: 'organizing' | 'cleanup' | 'complete'): number {
    const stepProgress = {
      organizing: 30,   // 30% of finalization
      cleanup: 70,      // 70% of finalization
      complete: 100     // 100% of finalization
    };
    
    const baseProgress = this.STARTUP_PERCENTAGE + this.DOWNLOAD_PERCENTAGE;
    return Math.round(baseProgress + (stepProgress[step] / 100) * this.FINALIZATION_PERCENTAGE);
  }

  /**
   * Get progress percentage for overall task status
   */
  getOverallProgress(
    phase: 'startup' | 'downloading' | 'finalizing',
    details: Partial<ChapterProgressInfo> & { step?: string }
  ): number {
    switch (phase) {
      case 'startup': {
        const step = details.step as 'initializing' | 'connecting' | 'ready' | undefined;
        return this.calculateStartupProgress(step || 'initializing');
      }
        
      case 'downloading': {
        // Ensure required fields exist for ChapterProgressInfo
        if (typeof details.chapterIndex === 'number' && typeof details.totalChapters === 'number' && details.chapterPhase) {
          return this.calculateDownloadProgress(details as ChapterProgressInfo);
        }
        return this.STARTUP_PERCENTAGE; // Fallback
      }
        
      case 'finalizing': {
        const step = details.step as 'organizing' | 'cleanup' | 'complete' | undefined;
        return this.calculateFinalizationProgress(step || 'organizing');
      }
        
      default:
        return 0;
    }
  }

  /**
   * Calculate smooth progress for UI animations
   */
  calculateSmoothProgress(
    currentProgress: number,
    targetProgress: number,
    smoothingFactor: number = 0.3
  ): number {
    if (Math.abs(targetProgress - currentProgress) < 1) {
      return targetProgress;
    }
    
    // Smooth transition to avoid jerky progress bars
    const diff = targetProgress - currentProgress;
    const increment = diff * smoothingFactor;
    
    return Math.round(currentProgress + increment);
  }

  /**
   * Estimate time remaining based on current progress and elapsed time
   */
  estimateTimeRemaining(
    currentProgress: number,
    elapsedTime: number
  ): number | null {
    if (currentProgress <= 5) {
      return null; // Too early to estimate
    }
    
    const progressPercentage = currentProgress / 100;
    const timePerPercent = elapsedTime / progressPercentage;
    const remainingPercentage = 1 - progressPercentage;
    
    return Math.round(remainingPercentage * timePerPercent);
  }

  /**
   * Get human-readable progress message
   */
  getProgressMessage(
    phase: 'startup' | 'downloading' | 'finalizing',
    details: Partial<ChapterProgressInfo> & { step?: string }
  ): string {
    switch (phase) {
      case 'startup':
        return details.step === 'initializing' ? 'Initializing download...' :
               details.step === 'connecting' ? 'Connecting to server...' :
               'Starting download...';
               
      case 'downloading': {
        const { chapterIndex, totalChapters, chapterPhase } = details;
        const chapterNum = (chapterIndex ?? 0) + 1;
        
        switch (chapterPhase) {
          case 'fetching_html':
            return `Chapter ${chapterNum}/${totalChapters}: Loading page...`;
          case 'extracting_urls':
            return `Chapter ${chapterNum}/${totalChapters}: Finding images...`;
          case 'downloading_images': {
            const { imageIndex = 0, totalImages = 0 } = details;
            return `Chapter ${chapterNum}/${totalChapters}: Downloading ${imageIndex}/${totalImages} images...`;
          }
          case 'creating_archive':
            return `Chapter ${chapterNum}/${totalChapters}: Creating archive...`;
          default:
            return `Chapter ${chapterNum}/${totalChapters}: Processing...`;
        }
      }
        
      case 'finalizing':
        return details.step === 'organizing' ? 'Organizing files...' :
               details.step === 'cleanup' ? 'Cleaning up...' :
               'Download complete!';
               
      default:
        return 'Processing...';
    }
  }
}

// Export singleton instance
export const progressCalculator = new IntelligentProgressCalculator();
