/**
 * Type utilities for test files
 * Provides safer alternatives to 'any' while maintaining test flexibility
 */

/**
 * Helper to safely access unknown objects with Record type
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Helper to safely access arrays of unknown objects
 */
export function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return value as Array<Record<string, unknown>>;
}

/**
 * Extract property from unknown object
 */
export function getProp<T = unknown>(obj: unknown, prop: string): T | undefined {
  const record = asRecord(obj);
  return record[prop] as T;
}
