/**
 * Standardized error types for consistent error handling across the extension
 */

export enum ErrorCode {
  // Network and connectivity errors
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  CORS_ERROR = "CORS_ERROR",

  // Content extraction errors
  CONTENT_NOT_FOUND = "CONTENT_NOT_FOUND",
  EXTRACTION_FAILED = "EXTRACTION_FAILED",
  INVALID_PAGE_STRUCTURE = "INVALID_PAGE_STRUCTURE",

  // Download errors
  DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
  FILE_ACCESS_ERROR = "FILE_ACCESS_ERROR",
  STORAGE_ERROR = "STORAGE_ERROR",

  // Site integration errors
  SITE_INTEGRATION_NOT_FOUND = "SITE_INTEGRATION_NOT_FOUND",
  SITE_INTEGRATION_INITIALIZATION_FAILED = "SITE_INTEGRATION_INITIALIZATION_FAILED",
  UNSUPPORTED_SITE = "UNSUPPORTED_SITE",

  // Configuration and validation errors
  INVALID_CONFIGURATION = "INVALID_CONFIGURATION",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  PERMISSION_DENIED = "PERMISSION_DENIED",

  // File System Access API permission errors
  PERMISSION_EXPIRED = "PERMISSION_EXPIRED",
  DIRECTORY_NOT_FOUND = "DIRECTORY_NOT_FOUND",
  DISK_FULL = "DISK_FULL",

  // Extension lifecycle errors
  EXTENSION_NOT_READY = "EXTENSION_NOT_READY",
  TAB_NOT_AVAILABLE = "TAB_NOT_AVAILABLE",
  CONTENT_SCRIPT_ERROR = "CONTENT_SCRIPT_ERROR",

  // Queue and task management errors
  QUEUE_FULL = "QUEUE_FULL",
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  TASK_ALREADY_EXISTS = "TASK_ALREADY_EXISTS",

  // Generic errors
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  OPERATION_CANCELED = "OPERATION_CANCELED",
}

export interface ErrorContext {
  component: string
  operation: string
  url?: string
  tabId?: number
  integrationName?: string
  timestamp: number
}

/**
 * Standardized extension error class
 */
export class ExtensionError extends Error {
  public readonly code: ErrorCode
  public readonly context: ErrorContext
  public readonly originalError?: Error

  constructor(
    code: ErrorCode,
    message: string,
    context: Partial<ErrorContext>,
    originalError?: Error
  ) {
    super(message)
    this.name = "ExtensionError"
    this.code = code
    this.context = {
      component: context.component || "unknown",
      operation: context.operation || "unknown",
      timestamp: Date.now(),
      ...context,
    }
    this.originalError = originalError

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExtensionError)
    }
  }
}

/**
 * Specialized permission error classes for File System Access API
 */

export class PermissionExpiredError extends ExtensionError {
  constructor(context: Partial<ErrorContext>, originalError?: Error) {
    super(
      ErrorCode.PERMISSION_EXPIRED,
      "Download folder permission has expired. Please re-grant permission in Options.",
      context,
      originalError
    )
    this.name = "PermissionExpiredError"
  }
}

export class DirectoryNotFoundError extends ExtensionError {
  constructor(
    directoryPath: string,
    context: Partial<ErrorContext>,
    originalError?: Error
  ) {
    super(
      ErrorCode.DIRECTORY_NOT_FOUND,
      `Download folder not found: ${directoryPath}. The folder may have been moved or deleted.`,
      context,
      originalError
    )
    this.name = "DirectoryNotFoundError"
  }
}
