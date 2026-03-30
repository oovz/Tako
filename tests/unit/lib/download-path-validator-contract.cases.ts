import { describe, expect, it } from 'vitest';
import { validateResolvedPath } from '@/src/shared/download-path-validator';
import type { ValidationResult } from '@/src/shared/download-path-validator';

export function registerValidationResultContractCases(): void {
  describe('validateResolvedPath', () => {
    describe('ValidationResult interface', () => {
      it('returns correct structure for valid path', () => {
        const result: ValidationResult = validateResolvedPath('manga/series');
        expect(result).toHaveProperty('isValid');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('returns correct structure for invalid path', () => {
        const result: ValidationResult = validateResolvedPath('path:invalid');
        expect(result).toHaveProperty('isValid');
        expect(result).toHaveProperty('error');
        expect(result.isValid).toBe(false);
        expect(typeof result.error).toBe('string');
      });
    });
  });
}
