import { describe, it, expect } from 'vitest';
import {
  validateMessageText,
  isExpired,
  MESSAGE_MAX_LENGTH,
} from '../../../src/shared/validation/constraints.js';

describe('constraints', () => {
  describe('validateMessageText', () => {
    it('returns null for valid text', () => {
      expect(validateMessageText('Hello')).toBeNull();
    });

    it('rejects non-string', () => {
      expect(validateMessageText(123)).toContain('string');
    });

    it('rejects empty string', () => {
      expect(validateMessageText('')).toContain('empty');
    });

    it('rejects text exceeding max length', () => {
      expect(validateMessageText('a'.repeat(MESSAGE_MAX_LENGTH + 1))).toContain(
        'exceed',
      );
    });

    it('accepts text at max length', () => {
      expect(validateMessageText('a'.repeat(MESSAGE_MAX_LENGTH))).toBeNull();
    });
  });

  describe('isExpired', () => {
    it('returns false for recent timestamps', () => {
      expect(isExpired(Date.now())).toBe(false);
    });

    it('returns true for old timestamps', () => {
      expect(isExpired(Date.now() - 600_000, 300_000)).toBe(true);
    });

    it('respects custom expiry', () => {
      expect(isExpired(Date.now() - 1000, 2000)).toBe(false);
      expect(isExpired(Date.now() - 3000, 2000)).toBe(true);
    });
  });
});
