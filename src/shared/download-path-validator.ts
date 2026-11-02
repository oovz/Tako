/** Validate relative download paths and template syntax. */

export interface ValidationResult {
  isValid: boolean
  error?: string
}

/** Validate a relative path before template expansion. */
export function validateDownloadPath(path: string): ValidationResult {
  if (!path || path.trim() === "") {
    return {
      isValid: false,
      error: "Download path cannot be empty",
    }
  }

  const trimmedPath = path.trim()

  // Reject reserved filename characters while allowing template brackets.
  if (!/^[^:"|?*]*$/.test(trimmedPath)) {
    return {
      isValid: false,
      error: 'Download path contains invalid characters. Cannot use: : " | ? *',
    }
  }

  // Check for parent directory references (path traversal)
  const segments = trimmedPath.split("/")
  if (segments.includes("..")) {
    return {
      isValid: false,
      error: "Download path cannot contain parent directory references (..)",
    }
  }

  // Check for backslashes (forward slash is the path separator)
  if (trimmedPath.includes("\\")) {
    return {
      isValid: false,
      error: "Download path cannot contain backslashes",
    }
  }

  // Check for leading slash (invalid for relative paths)
  if (trimmedPath.startsWith("/")) {
    return {
      isValid: false,
      error: "Download path cannot start with a slash",
    }
  }

  return validateTemplateBrackets(trimmedPath)
}

function validateTemplateBrackets(path: string): ValidationResult {
  const openBrackets = (path.match(/</g) || []).length
  const closeBrackets = (path.match(/>/g) || []).length
  if (openBrackets !== closeBrackets) {
    return {
      isValid: false,
      error: "Download path has unmatched template brackets < >",
    }
  }
  return { isValid: true }
}

/** Validate an expanded path with no remaining template tokens. */
export function validateResolvedPath(resolvedPath: string): ValidationResult {
  const basicValidation = validateDownloadPath(resolvedPath)
  if (!basicValidation.isValid) {
    return basicValidation
  }

  const trimmedPath = resolvedPath.trim()

  // After template resolution, there should be no remaining template brackets
  if (trimmedPath.includes("<") || trimmedPath.includes(">")) {
    return {
      isValid: false,
      error: "Download path contains unresolved template variables",
    }
  }

  // Resolved paths cannot contain empty components.
  if (trimmedPath.includes("//")) {
    return {
      isValid: false,
      error: "Download path contains invalid double slashes",
    }
  }

  return { isValid: true }
}
