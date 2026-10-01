import { describe, expect, it } from 'vitest';
import { and, type NotOk, notOk, type Ok, ok, okVoid, or } from '../src/result';

describe('result', () => {
  describe('ok()', () => {
    it('creates a successful result with a value', () => {
      const result = ok(42);
      expect(result).toMatchObject({ ok: true, value: 42 });
    });

    it('creates a frozen result', () => {
      const result = ok('test');
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('notOk()', () => {
    it('creates an unsuccessful result with failure details', () => {
      const result = notOk({ code: 'ERR_TEST', message: 'Test error' });
      expect(result).toMatchObject({
        ok: false,
        failure: { code: 'ERR_TEST', message: 'Test error' },
      });
    });

    it('creates a frozen result', () => {
      const result = notOk('error');
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('okVoid()', () => {
    it('returns a successful void result', () => {
      const result = okVoid();
      expect(result.ok).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it('returns the same singleton instance', () => {
      const result1 = okVoid();
      const result2 = okVoid();
      expect(result1).toBe(result2);
    });
  });

  describe('assertOk()', () => {
    it('returns the value for Ok results', () => {
      const result = ok(42);
      expect(result.assertOk()).toBe(42);
    });

    it('throws for NotOk results', () => {
      const result = notOk('error');
      expect(() => result.assertOk()).toThrow('Expected Ok result but got NotOk');
    });
  });

  describe('assertNotOk()', () => {
    it('returns the failure for NotOk results', () => {
      const result = notOk({ code: 'ERR_TEST' });
      expect(result.assertNotOk()).toEqual({ code: 'ERR_TEST' });
    });

    it('throws for Ok results', () => {
      const result = ok(42);
      expect(() => result.assertNotOk()).toThrow('Expected NotOk result but got Ok');
    });
  });

  describe('property access', () => {
    it('allows accessing value on Ok results', () => {
      const result = ok(42);
      expect(result.value).toBe(42);
    });

    it('throws when accessing failure on Ok results', () => {
      const result = ok(42);
      expect(() => (result as unknown as NotOk<number>).failure).toThrow(
        'Cannot access failure on Ok result',
      );
    });

    it('allows accessing failure on NotOk results', () => {
      const result = notOk('error');
      expect(result.failure).toBe('error');
    });

    it('throws when accessing value on NotOk results', () => {
      const result = notOk('error');
      expect(() => (result as unknown as Ok<number>).value).toThrow(
        'Cannot access value on NotOk result',
      );
    });
  });

  describe('and()', () => {
    it('is ok when both sides are ok', () => {
      expect(and(ok(1), ok('two'))).toMatchObject({ ok: true });
    });

    it('takes the failure when the right side fails', () => {
      expect(and(ok(1), notOk(['right']))).toMatchObject({ ok: false, failure: ['right'] });
    });

    it('takes the failure when the left side fails', () => {
      expect(and(notOk(['left']), ok(1))).toMatchObject({ ok: false, failure: ['left'] });
    });

    it('keeps both sides details in order when both fail', () => {
      expect(and(notOk(['left']), notOk(['right']))).toMatchObject({
        ok: false,
        failure: ['left', 'right'],
      });
    });

    it('keeps a detail-less failure a failure', () => {
      expect(and(ok(1), notOk([]))).toMatchObject({ ok: false, failure: [] });
    });
  });

  describe('or()', () => {
    it('takes the left value when both sides are ok', () => {
      expect(or(ok('left'), ok('right'))).toMatchObject({ ok: true, value: 'left' });
    });

    it('takes the right value when only the right side is ok', () => {
      expect(or(notOk(['left']), ok('right'))).toMatchObject({ ok: true, value: 'right' });
    });

    it('takes the left value when only the left side is ok', () => {
      expect(or(ok('left'), notOk(['right']))).toMatchObject({ ok: true, value: 'left' });
    });

    it('pools both sides details in order when both fail loudly', () => {
      expect(or(notOk(['left']), notOk(['right']))).toMatchObject({
        ok: false,
        failure: ['left', 'right'],
      });
    });

    it('lets a detail-less failure absorb the left side', () => {
      expect(or(notOk([]), notOk(['right']))).toMatchObject({ ok: false, failure: [] });
    });

    it('lets a detail-less failure absorb the right side', () => {
      expect(or(notOk(['left']), notOk([]))).toMatchObject({ ok: false, failure: [] });
    });

    it('stays detail-less when both sides are detail-less', () => {
      expect(or(notOk([]), notOk([]))).toMatchObject({ ok: false, failure: [] });
    });
  });
});
