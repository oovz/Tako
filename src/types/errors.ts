/**
 * Standardized error types for consistent error handling across the extension
 */

export enum ErrorCode {
  // Network and connectivity errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CORS_ERROR = 'CORS_ERROR',
  
  // Content extraction errors
  CONTENT_NOT_FOUND = 'CONTENT_NOT_FOUND',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  INVALID_PAGE_STRUCTURE = 'INVALID_PAGE_STRUCTURE',
  
  // Download errors
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  FILE_ACCESS_ERROR = 'FILE_ACCESS_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  
  // Site integration errors
  SITE_INTEGRATION_NOT_FOUND = 'SITE_INTEGRATION_NOT_FOUND',
  SITE_INTEGRATION_INITIALIZATION_FAILED = 'SITE_INTEGRATION_INITIALIZATION_FAILED',
  UNSUPPORTED_SITE = 'UNSUPPORTED_SITE',
  
  // Configuration and validation errors
  INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  // File System Access API permission errors
  PERMISSION_EXPIRED = 'PERMISSION_EXPIRED',
  DIRECTORY_NOT_FOUND = 'DIRECTORY_NOT_FOUND',
  DISK_FULL = 'DISK_FULL',
  
  // Extension lifecycle errors
  EXTENSION_NOT_READY = 'EXTENSION_NOT_READY',
  TAB_NOT_AVAILABLE = 'TAB_NOT_AVAILABLE',
  CONTENT_SCRIPT_ERROR = 'CONTENT_SCRIPT_ERROR',
  
  // Queue and task management errors
  QUEUE_FULL = 'QUEUE_FULL',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_ALREADY_EXISTS = 'TASK_ALREADY_EXISTS',
  
  // Generic errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  OPERATION_CANCELED = 'OPERATION_CANCELED'
}

export interface ErrorContext {
  component: string;
  operation: string;
  url?: string;
  tabId?: number;
  integrationName?: string;
  timestamp: number;
}

/**
 * Standardized extension error class
 */
export class ExtensionError extends Error {
  public readonly code: ErrorCode;
  public readonly context: ErrorContext;
  public readonly originalError?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    context: Partial<ErrorContext>,
    originalError?: Error
  ) {
    super(message);
    this.name = 'ExtensionError';
    this.code = code;
    this.context = {
      component: context.component || 'unknown',
      operation: context.operation || 'unknown',
      timestamp: Date.now(),
      ...context
    };
    this.originalError = originalError;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExtensionError);
    }
  }

  /**
   * Create an ExtensionError from an unknown error
   */
  static fromError(
    error: unknown,
    code: ErrorCode,
    context: Partial<ErrorContext>
  ): ExtensionError {
    if (error instanceof ExtensionError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const originalError = error instanceof Error ? error : undefined;

    return new ExtensionError(code, message, context, originalError);
  }

  /**
   * Get a user-friendly error message
   */
  getUserMessage(): string {
    switch (this.code) {
      case ErrorCode.NETWORK_ERROR:
        return 'Network connection failed. Please check your internet connection.';
      case ErrorCode.CONTENT_NOT_FOUND:
        return 'Could not find manga content on this page. The site structure may have changed.';
      case ErrorCode.EXTRACTION_FAILED:
        return 'Failed to extract manga data. This might be a temporary issue.';
      case ErrorCode.DOWNLOAD_FAILED:
        return 'Download failed. Please try again.';
      case ErrorCode.SITE_INTEGRATION_NOT_FOUND:
        return 'This manga site is not supported yet.';
      case ErrorCode.TAB_NOT_AVAILABLE:
        return 'Please keep the manga page open during download.';
      case ErrorCode.PERMISSION_DENIED:
        return 'Permission denied. Please check browser permissions.';
      case ErrorCode.PERMISSION_EXPIRED:
        return 'Download folder permission expired. Please re-grant permission in Options.';
      case ErrorCode.DIRECTORY_NOT_FOUND:
        return 'Download folder not found. Please select a new folder in Options.';
      case ErrorCode.DISK_FULL:
        return 'Disk is full. Please free up space and try again.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Serialize error for logging or transmission
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack
      } : undefined
    };
  }
}

/**
 * Specialized permission error classes for File System Access API
 */

export class PermissionExpiredError extends ExtensionError {
  constructor(context: Partial<ErrorContext>, originalError?: Error) {
    super(
      ErrorCode.PERMISSION_EXPIRED,
      'Download folder permission has expired. Please re-grant permission in Options.',
      context,
      originalError
    );
    this.name = 'PermissionExpiredError';
  }
}

export class DirectoryNotFoundError extends ExtensionError {
  constructor(directoryPath: string, context: Partial<ErrorContext>, originalError?: Error) {
    super(
      ErrorCode.DIRECTORY_NOT_FOUND,
      `Download folder not found: ${directoryPath}. The folder may have been moved or deleted.`,
      context,
      originalError
    );
    this.name = 'DirectoryNotFoundError';
  }
}

export class DiskFullError extends ExtensionError {
  constructor(context: Partial<ErrorContext>, availableSpace?: number, originalError?: Error) {
    const spaceMsg = availableSpace !== undefined ? ` (${Math.round(availableSpace / 1024 / 1024)}MB available)` : '';
    super(
      ErrorCode.DISK_FULL,
      `Insufficient disk space${spaceMsg}. Please free up space and try again.`,
      context,
      originalError
    );
    this.name = 'DiskFullError';
  }
}

/**
 * Error handling utilities
 */
import logger from '@/src/runtime/logger';

export class ErrorHandler {
  /**
   * Handle and log errors consistently
   */
  static handle(error: unknown, context: Partial<ErrorContext>): ExtensionError {
    const extensionError = error instanceof ExtensionError 
      ? error 
      : ExtensionError.fromError(error, ErrorCode.UNKNOWN_ERROR, context);

  // Log error with context
  logger.error(`[${extensionError.context.component}] ${extensionError.code}:`, {
      message: extensionError.message,
      context: extensionError.context,
      originalError: extensionError.originalError,
      stack: extensionError.stack
    });

    return extensionError;
  }

  /**
   * Create a standardized error response for message passing
   */
  static createErrorResponse(error: unknown, context: Partial<ErrorContext>) {
    const extensionError = this.handle(error, context);
    return {
      success: false,
      error: {
        code: extensionError.code,
        message: extensionError.message,
        userMessage: extensionError.getUserMessage(),
        context: extensionError.context
      }
    };
  }
}

