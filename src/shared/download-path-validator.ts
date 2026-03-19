/**
 * Download path validation utilities
 * Centralized validation logic for download path templates
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates a download path for basic filesystem and template requirements
 * 
 * @param path - The download path to validate
 * @returns ValidationResult with isValid boolean and optional error message
 */
export function validateDownloadPath(path: string): ValidationResult {
  if (!path || path.trim() === '') {
    return {
      isValid: false,
      error: 'Download path cannot be empty'
    };
  }

  const trimmedPath = path.trim();

  // Check for invalid filesystem characters
  // Allow letters, numbers, spaces, hyphens, underscores, dots, slashes, and template brackets
  if (!/^[^:"|?*]*$/.test(trimmedPath)) {
    return {
      isValid: false,
      error: 'Download path contains invalid characters. Cannot use: : " | ? *'
    };
  }

  // Check for leading slash (invalid for relative paths)
  if (trimmedPath.startsWith('/')) {
    return {
      isValid: false,
      error: 'Download path cannot start with a slash'
    };
  }

  // Check for basic template syntax balance
  const openBrackets = (trimmedPath.match(/</g) || []).length;
  const closeBrackets = (trimmedPath.match(/>/g) || []).length;
  
  if (openBrackets !== closeBrackets) {
    return {
      isValid: false,
      error: 'Download path has unmatched template brackets < >'
    };
  }

  return { isValid: true };
}

/**
 * Validates a resolved download path (after template expansion)
 * More strict validation for final paths before actual download
 * 
 * @param resolvedPath - The path after template variables have been expanded
 * @returns ValidationResult with isValid boolean and optional error message
 */
export function validateResolvedPath(resolvedPath: string): ValidationResult {
  const basicValidation = validateDownloadPath(resolvedPath);
  if (!basicValidation.isValid) {
    return basicValidation;
  }

  const trimmedPath = resolvedPath.trim();

  // After template resolution, there should be no remaining template brackets
  if (trimmedPath.includes('<') || trimmedPath.includes('>')) {
    return {
      isValid: false,
      error: 'Download path contains unresolved template variables'
    };
  }

  // Check for double slashes (except for Windows drive paths)
  if (trimmedPath.includes('//') && !trimmedPath.match(/^[A-Za-z]:\//)) {
    return {
      isValid: false,
      error: 'Download path contains invalid double slashes'
    };
  }

  return { isValid: true };
}
