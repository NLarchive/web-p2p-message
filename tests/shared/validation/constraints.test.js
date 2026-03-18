import { describe, it, expect } from 'vitest';
import {
  validateMessageText,
  validateTimestamp,
  isExpired,
  CLOCK_SKEW_MS,
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

  describe('validateTimestamp', () => {
    it('accepts a recent timestamp', () => {
      expect(validateTimestamp(Date.now())).toBeNull();
    });

    it('accepts a timestamp within the clock-skew window', () => {
      expect(validateTimestamp(Date.now() + CLOCK_SKEW_MS - 100)).toBeNull();
    });

    it('rejects Infinity', () => {
      expect(validateTimestamp(Infinity)).toMatch(/finite/);
    });

    it('rejects -Infinity', () => {
      expect(validateTimestamp(-Infinity)).toMatch(/finite/);
    });

    it('rejects zero', () => {
      expect(validateTimestamp(0)).toMatch(/positive finite/);
    });

    it('rejects a negative timestamp', () => {
      expect(validateTimestamp(-1)).toMatch(/positive finite/);
    });

    it('rejects a far-future timestamp', () => {
      expect(validateTimestamp(Date.now() + CLOCK_SKEW_MS + 5000)).toMatch(/future/);
    });

    it('rejects non-number values', () => {
      expect(validateTimestamp('2026-01-01')).toMatch(/finite/);
      expect(validateTimestamp(null)).toMatch(/finite/);
    });
  });
});
