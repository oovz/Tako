/**
 * Centralized Type Guards and Utility Types
 * 
 * This file provides shared type guard functions and utility types used across
 * the codebase for safe runtime type checking of storage values and JSON data.
 * 
 * Ref: TypeScript-ESLint best practices - use `unknown` for type guard parameters
 * https://typescript-eslint.io/rules/no-unsafe-argument/
 */

/**
 * Recursive JSON-safe value type for chrome.storage and JSON operations.
 * This is the base type for all values stored in chrome.storage.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Alias for JsonValue used in chrome.storage contexts.
 * Semantically indicates the value comes from extension storage.
 */
export type StorageValue = JsonValue;

/**
 * Type guard to check if a value is a non-null, non-array object (record).
 * Used as a foundation for more specific type guards.
 * 
 * @param value - The value to check (typed as unknown for type safety)
 * @returns True if value is a plain object (not null, not array)
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Type guard variant that narrows to JsonValue record.
 * Use when you need the result to be assignable to JsonValue contexts.
 */
export const isJsonRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Type guard variant that narrows to StorageValue record.
 * Use when working with chrome.storage API results.
 */
export const isStorageRecord = (value: unknown): value is Record<string, StorageValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Safely convert an unknown error to an Error instance.
 * Useful for catch blocks and Promise rejections where the error type is unknown.
 * 
 * @param error - The caught error (unknown type)
 * @param fallbackMessage - Message to use if error is not an Error instance
 * @returns An Error instance
 */
export const toError = (error: unknown, fallbackMessage = 'Unknown error'): Error => {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error(fallbackMessage);
};

/**
 * Check if a value is a non-empty string.
 */
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Check if a value is a finite number (not NaN, not Infinity).
 */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Check if a value is an array of strings.
 */
export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
