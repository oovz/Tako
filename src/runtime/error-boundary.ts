/**
 * Error Boundary System for Chrome Extension
 * 
 * Provides fail-fast error handling with comprehensive logging and user notifications
 */

import logger from '@/src/runtime/logger';

// Component types
const ComponentType = {
  BACKGROUND: 'background' as const,
  CONTENT: 'content' as const,
  POPUP: 'popup' as const,
  INJECTED: 'injected' as const,
  OFFSCREEN: 'offscreen' as const
} as const;

type ComponentType = typeof ComponentType[keyof typeof ComponentType];

export interface ErrorContext {
  component: ComponentType;
  operation: string;
  timestamp: number;
  userAgent?: string;
  url?: string;
  additionalData?: Record<string, unknown>;
}

export interface ErrorReport {
  error: Error;
  context: ErrorContext;
  stack?: string;
  severity: ErrorSeverity;
  isRecoverable: boolean;
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

const coerceError = (error: unknown, fallback: string): Error => {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error(fallback);
};

/**
 * Global error boundary for Chrome extension components
 */
export class ExtensionErrorBoundary {
  private static instance: ExtensionErrorBoundary;
  private errorReports: ErrorReport[] = [];
  private componentType: ComponentType;
  private maxErrorReports = 100;

  private constructor(componentType: ComponentType) {
    this.componentType = componentType;
    this.setupGlobalErrorHandlers();
  }

  static getInstance(componentType: ComponentType): ExtensionErrorBoundary {
    if (!ExtensionErrorBoundary.instance) {
      ExtensionErrorBoundary.instance = new ExtensionErrorBoundary(componentType);
    }
    return ExtensionErrorBoundary.instance;
  }

  /**
   * Handle error with fail-fast strategy
   */
  handleError(error: Error, context: Partial<ErrorContext>, severity: ErrorSeverity = ErrorSeverity.MEDIUM): void {
    const fullContext: ErrorContext = {
      component: this.componentType,
      operation: 'unknown',
      timestamp: Date.now(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location?.href : undefined,
      ...context
    };

    const errorReport: ErrorReport = {
      error,
      context: fullContext,
      stack: error.stack,
      severity,
      isRecoverable: this.isErrorRecoverable(error, severity)
    };

    // Store error report
    this.addErrorReport(errorReport);

    // Log error with context
    this.logError(errorReport);

    // Fail-fast for critical errors
    if (severity === ErrorSeverity.CRITICAL || !errorReport.isRecoverable) {
      this.handleCriticalError(errorReport);
    }

    // Notify user for high/critical errors
    if (severity === ErrorSeverity.HIGH || severity === ErrorSeverity.CRITICAL) {
      void this.notifyUser(errorReport);
    }
  }

  /**
   * Wrap async function with error boundary
   */
  wrapAsync<T extends unknown[], R>(
    fn: (...args: T) => Promise<R>,
    context: Partial<ErrorContext>,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handleError(error as Error, context, severity);
        throw error; // Re-throw for fail-fast behavior
      }
    };
  }

  /**
   * Wrap sync function with error boundary
   */
  wrapSync<T extends unknown[], R>(
    fn: (...args: T) => R,
    context: Partial<ErrorContext>,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
  ): (...args: T) => R {
    return (...args: T): R => {
      try {
        return fn(...args);
      } catch (error) {
        this.handleError(error as Error, context, severity);
        throw error; // Re-throw for fail-fast behavior
      }
    };
  }

  /**
   * Setup global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    // Handle unhandled promise rejections
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        const err = coerceError(event.reason, 'Unhandled Promise Rejection');
        this.handleError(
          err,
          { operation: 'unhandled-promise-rejection' },
          ErrorSeverity.HIGH
        );
      });

      // Handle global errors
      window.addEventListener('error', (event) => {
        const err = event.error instanceof Error
          ? event.error
          : new Error(event.message || 'Global error');
        this.handleError(
          err,
          { 
            operation: 'global-error',
            additionalData: { 
              filename: event.filename, 
              lineno: event.lineno, 
              colno: event.colno 
            }
          },
          ErrorSeverity.HIGH
        );
      });
    }

    // Handle uncaught exceptions in service worker context
    if (typeof self !== 'undefined' && 'addEventListener' in self) {
      self.addEventListener('error', (event) => {
        const err = coerceError(event.error, 'Service Worker Error');
        this.handleError(
          err,
          { operation: 'service-worker-error' },
          ErrorSeverity.HIGH
        );
      });
    }
  }

  /**
   * Determine if error is recoverable
   */
  private isErrorRecoverable(error: Error, severity: ErrorSeverity): boolean {
    // Critical errors are never recoverable
    if (severity === ErrorSeverity.CRITICAL) {
      return false;
    }

    // Check for specific error patterns
    const unrecoverablePatterns = [
      /Port.*disconnect/i,
      /Extension context invalidated/i,
      /Cannot access chrome-extension/i,
      /Background script.*terminated/i
    ];

    return !unrecoverablePatterns.some(pattern => 
      pattern.test(error.message) || pattern.test(error.name)
    );
  }

  /**
   * Handle critical errors with immediate action
   */
  private handleCriticalError(errorReport: ErrorReport): void {
  logger.error('🚨 CRITICAL ERROR - Extension may be unstable:', errorReport);
    
    // Try to save error state
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        void chrome.storage.local.set({
          lastCriticalError: {
            timestamp: errorReport.context.timestamp,
            message: errorReport.error.message,
            component: errorReport.context.component,
            operation: errorReport.context.operation
          }
        });
      }
    } catch (storageError) {
      logger.error('Failed to save critical error state:', storageError);
    }

    // Critical errors require immediate user attention
    this.showCriticalErrorNotification(errorReport);
  }

  /**
   * Log error with comprehensive context
   */
  private logError(errorReport: ErrorReport): void {
    const timestamp = new Date(errorReport.context.timestamp).toISOString();
    const prefix = `[ErrorBoundary:${errorReport.context.component}]`;
    
    const logData = {
      severity: errorReport.severity,
      operation: errorReport.context.operation,
      recoverable: errorReport.isRecoverable,
      message: errorReport.error.message,
      stack: errorReport.stack,
      context: errorReport.context.additionalData
    };

    switch (errorReport.severity) {
      case ErrorSeverity.CRITICAL:
        logger.error(`${timestamp} ${prefix} 🚨 CRITICAL:`, logData);
        break;
      case ErrorSeverity.HIGH:
        logger.error(`${timestamp} ${prefix} ❌ HIGH:`, logData);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(`${timestamp} ${prefix} ⚠️ MEDIUM:`, logData);
        break;
      case ErrorSeverity.LOW:
        logger.info(`${timestamp} ${prefix} ℹ️ LOW:`, logData);
        break;
    }
  }

  /**
   * Notify user of errors
   */
  private notifyUser(errorReport: ErrorReport): void {
    const message = this.formatUserErrorMessage(errorReport);
    
    try {
      // Try to show browser notification if available
      if (typeof chrome !== 'undefined' && chrome.notifications) {
        const iconUrl = chrome.runtime?.getURL
          ? chrome.runtime.getURL('icon/128.png')
          : 'icon/128.png';
        chrome.notifications.create({
          type: 'basic',
          iconUrl,
          title: 'Tako Manga Downloader Error',
          message
        });
      } else {
        // Fallback to console for environments without notifications
        logger.error(`User Notification: ${message}`);
      }
    } catch (notificationError) {
      logger.error('Failed to notify user of error:', notificationError);
    }
  }

  /**
   * Show critical error notification
   */
  private showCriticalErrorNotification(errorReport: ErrorReport): void {
    const message = `Critical error in ${errorReport.context.component}: ${errorReport.error.message}. Extension may be unstable.`;
    
    // Try multiple notification methods
    try {
      if (typeof chrome !== 'undefined' && chrome.notifications) {
        const iconUrl = chrome.runtime?.getURL
          ? chrome.runtime.getURL('icon/128.png')
          : 'icon/128.png';
        chrome.notifications.create({
          type: 'basic',
          iconUrl,
          title: 'Tako Manga Downloader - Critical Error',
          message,
          priority: 2
        });
      }
    } catch {
      // Fallback to alert if in content script context
      if (typeof window !== 'undefined' && window.alert) {
        window.alert(`Tako Manga Downloader Critical Error: ${message}`);
      } else {
        logger.error(`CRITICAL ERROR ALERT: ${message}`);
      }
    }
  }

  /**
   * Format error message for user display
   */
  private formatUserErrorMessage(errorReport: ErrorReport): string {
    const operation = errorReport.context.operation.replace(/-/g, ' ');
    const component = errorReport.context.component.replace('_', ' ').toLowerCase();
    
    switch (errorReport.severity) {
      case ErrorSeverity.CRITICAL:
        return `Critical error in ${component}: ${operation} failed. Please reload the extension.`;
      case ErrorSeverity.HIGH:
        return `Error in ${component}: ${operation} failed. Some features may not work.`;
      default:
        return `Warning in ${component}: ${operation} encountered an issue.`;
    }
  }

  /**
   * Add error report to storage
   */
  private addErrorReport(errorReport: ErrorReport): void {
    this.errorReports.push(errorReport);
    
    // Keep only recent reports
    if (this.errorReports.length > this.maxErrorReports) {
      this.errorReports = this.errorReports.slice(-this.maxErrorReports);
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    total: number;
    bySeverity: Record<ErrorSeverity, number>;
    byComponent: Record<ComponentType, number>;
    recent: ErrorReport[];
  } {
    const bySeverity = {} as Record<ErrorSeverity, number>;
    const byComponent = {} as Record<ComponentType, number>;
    
    Object.values(ErrorSeverity).forEach(severity => {
      bySeverity[severity] = 0;
    });
    
    Object.values(ComponentType).forEach(component => {
      byComponent[component] = 0;
    });

    this.errorReports.forEach(report => {
      bySeverity[report.severity]++;
      byComponent[report.context.component]++;
    });

    return {
      total: this.errorReports.length,
      bySeverity,
      byComponent,
      recent: this.errorReports.slice(-10)
    };
  }

  /**
   * Clear error reports
   */
  clearErrorReports(): void {
    this.errorReports = [];
  logger.info('🧹 Error reports cleared');
  }
}

/**
 * Utility function to create error boundary instance
 */
export function createErrorBoundary(componentType: ComponentType): ExtensionErrorBoundary {
  return ExtensionErrorBoundary.getInstance(componentType);
}

/**
 * Decorator for automatic error handling
 */
export function withErrorBoundary(
  target: unknown,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<unknown>,
  context: Partial<ErrorContext> = {},
  severity: ErrorSeverity = ErrorSeverity.MEDIUM
) {
  const originalValue = descriptor.value;
  if (typeof originalValue !== 'function') return descriptor;
  const originalMethod = originalValue as (this: unknown, ...args: unknown[]) => unknown;
  
  descriptor.value = function (this: unknown, ...args: unknown[]) {
    const errorBoundary = ExtensionErrorBoundary.getInstance(ComponentType.BACKGROUND); // Default
    
    try {
      const result = originalMethod.apply(this, args);
      
      if (result instanceof Promise) {
        return result.catch((error) => {
          const err = coerceError(error, 'Unhandled promise error');
          errorBoundary.handleError(err, {
            operation: propertyKey,
            ...context
          }, severity);
          throw err;
        });
      }
      
      return result;
    } catch (error) {
      const err = coerceError(error, 'Unhandled error');
      errorBoundary.handleError(err, {
        operation: propertyKey,
        ...context
      }, severity);
      throw err;
    }
  };
  
  return descriptor;
}

