// utils/filename-sanitizer.ts

/**
 * Sanitizes a string to be a valid filename across different operating systems.
 * @param filename - The input string to sanitize.
 * @returns The sanitized filename.
 */
export function sanitizeFilename(filename: string): string {
  if (typeof filename !== 'string') {
    return '';
  }

  // Characters to be replaced by an underscore.
  // Cross-platform illegal characters:
  // - Windows: < > : " / \ | ? *
  // - macOS/Linux: / (slash) and \0 (null, handled by controlRe)
  // We use the most restrictive (Windows) to ensure cross-platform compatibility
  // eslint-disable-next-line no-useless-escape
  const illegalRe = /[<>:"\/\\|?*]/g;
  // eslint-disable-next-line no-control-regex
  const controlRe = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRe = /^\.+$/;
  // Windows reserved names (case-insensitive): CON, PRN, AUX, NUL, COM0-COM9, LPT0-LPT9
  // These apply even with extensions (e.g., CON.txt is invalid)
  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  // Windows doesn't allow trailing dots or spaces
  // eslint-disable-next-line no-useless-escape
  const windowsTrailingRe = /[\. ]+$/;

  let sanitized = filename
    .replace(illegalRe, '_')
    .replace(controlRe, '_')
    .replace(reservedRe, '_')
    .replace(windowsReservedRe, '_')
    .replace(windowsTrailingRe, '_');

  // Truncate to a reasonable length to avoid issues with max path length.
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Image Filename Normalization
 * Converts image index to normalized filename with zero-padding and proper extension.
 * 
 * @param index - Zero-based image index (0 for first image)
 * @param totalImages - Total number of images in the chapter
 * @param mimeType - MIME type of the image (e.g., 'image/jpeg', 'image/png')
 * @param paddingDigits - Number of digits for zero-padding, or 'auto' to calculate from totalImages
 * @returns Normalized filename like "001.jpg", "002.png", "150.webp"
 * 
 * @example
 * normalizeImageFilename(0, 50, 'image/jpeg', 'auto') // => "01.jpg"
 * normalizeImageFilename(149, 150, 'image/png', 'auto') // => "150.png"
 * normalizeImageFilename(500, 1200, 'image/webp', 'auto') // => "0501.webp"
 * normalizeImageFilename(5, 100, 'image/jpeg', 3) // => "006.jpg"
 */
export function normalizeImageFilename(
  index: number,
  totalImages: number,
  mimeType: string,
  paddingDigits: 'auto' | 2 | 3 | 4 | 5 = 'auto'
): string {
  // Calculate zero-padding based on total images if 'auto'
  const digits = paddingDigits === 'auto' 
    ? String(totalImages).length 
    : paddingDigits;

  // Convert to 1-based index (001 for first image, not 000)
  const imageNumber = index + 1;
  const paddedIndex = String(imageNumber).padStart(digits, '0');

  // Detect extension from MIME type
  const extension = getExtensionFromMimeType(mimeType);

  return `${paddedIndex}.${extension}`;
}

/**
 * Extracts file extension from MIME type.
 * Defaults to 'jpg' if MIME type is unknown or invalid.
 * 
 * @param mimeType - MIME type string (e.g., 'image/jpeg', 'image/png')
 * @returns File extension without dot (e.g., 'jpg', 'png', 'webp')
 */
export function getExtensionFromMimeType(mimeType: string): string {
  if (!mimeType || typeof mimeType !== 'string') {
    return 'jpg'; // Default fallback
  }

  const lower = mimeType.toLowerCase();

  // Common image MIME types
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('bmp')) return 'bmp';
  if (lower.includes('svg')) return 'svg';
  if (lower.includes('tiff') || lower.includes('tif')) return 'tiff';
  if (lower.includes('avif')) return 'avif';

  // Fallback to jpg for unknown types
  return 'jpg';
}
