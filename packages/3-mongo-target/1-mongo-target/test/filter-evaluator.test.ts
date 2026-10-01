import {
  MongoAndExpr,
  MongoExistsExpr,
  MongoExprFilter,
  MongoFieldFilter,
  MongoOrExpr,
} from '@internal/mongo-query-ast/control';
import { MongoAggLiteral } from '@internal/mongo-query-ast/execution';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { FilterEvaluator } from '../src/core/migrations/filter-evaluator';

function evaluate(
  filter: Parameters<FilterEvaluator['evaluate']>[0],
  doc: Record<string, unknown>,
): boolean {
  return new FilterEvaluator().evaluate(filter, doc);
}

describe('FilterEvaluator', () => {
  describe('$eq', () => {
    it('matches equal primitive string', () => {
      expect(evaluate(MongoFieldFilter.eq('name', 'alice'), { name: 'alice' })).toBe(true);
    });

    it('rejects unequal primitive string', () => {
      expect(evaluate(MongoFieldFilter.eq('name', 'alice'), { name: 'bob' })).toBe(false);
    });

    it('matches equal number', () => {
      expect(evaluate(MongoFieldFilter.eq('age', 30), { age: 30 })).toBe(true);
    });

    it('rejects unequal number', () => {
      expect(evaluate(MongoFieldFilter.eq('age', 30), { age: 25 })).toBe(false);
    });

    it('matches equal boolean', () => {
      expect(evaluate(MongoFieldFilter.eq('active', true), { active: true })).toBe(true);
    });

    it('matches null', () => {
      expect(evaluate(MongoFieldFilter.eq('value', null), { value: null })).toBe(true);
    });

    it('matches nested object with same key order', () => {
      expect(evaluate(MongoFieldFilter.eq('key', { email: 1 }), { key: { email: 1 } })).toBe(true);
    });

    it('rejects nested object with different key order', () => {
      expect(evaluate(MongoFieldFilter.eq('key', { a: 1, b: 2 }), { key: { b: 2, a: 1 } })).toBe(
        false,
      );
    });

    it('matches equal arrays', () => {
      expect(evaluate(MongoFieldFilter.eq('tags', [1, 2, 3]), { tags: [1, 2, 3] })).toBe(true);
    });

    it('rejects arrays with different order', () => {
      expect(evaluate(MongoFieldFilter.eq('tags', [1, 2, 3]), { tags: [3, 2, 1] })).toBe(false);
    });

    it('rejects arrays with different length', () => {
      expect(evaluate(MongoFieldFilter.eq('tags', [1, 2]), { tags: [1, 2, 3] })).toBe(false);
    });

    it('matches deeply nested objects', () => {
      const expected = { a: { b: { c: 1 } } };
      expect(
        evaluate(MongoFieldFilter.eq('data', expected), { data: { a: { b: { c: 1 } } } }),
      ).toBe(true);
    });

    it('rejects missing field against non-null', () => {
      expect(evaluate(MongoFieldFilter.eq('missing', 'value'), { other: 'x' })).toBe(false);
    });

    it('rejects missing field against null', () => {
      expect(evaluate(MongoFieldFilter.eq('missing', null), { other: 'x' })).toBe(false);
    });
  });

  describe('$ne', () => {
    it('returns true for unequal values', () => {
      expect(evaluate(MongoFieldFilter.neq('name', 'alice'), { name: 'bob' })).toBe(true);
    });

    it('returns false for equal values', () => {
      expect(evaluate(MongoFieldFilter.neq('name', 'alice'), { name: 'alice' })).toBe(false);
    });
  });

  describe('$gt', () => {
    it('returns true when actual > expected', () => {
      expect(evaluate(MongoFieldFilter.gt('age', 18), { age: 25 })).toBe(true);
    });

    it('returns false when actual == expected', () => {
      expect(evaluate(MongoFieldFilter.gt('age', 25), { age: 25 })).toBe(false);
    });

    it('returns false when actual < expected', () => {
      expect(evaluate(MongoFieldFilter.gt('age', 30), { age: 25 })).toBe(false);
    });

    it('returns false for type mismatch', () => {
      expect(evaluate(MongoFieldFilter.gt('age', 18), { age: '25' })).toBe(false);
    });
  });

  describe('$gte', () => {
    it('returns true when actual >= expected', () => {
      expect(evaluate(MongoFieldFilter.gte('age', 25), { age: 25 })).toBe(true);
    });

    it('returns false when actual < expected', () => {
      expect(evaluate(MongoFieldFilter.gte('age', 30), { age: 25 })).toBe(false);
    });
  });

  describe('$lt', () => {
    it('returns true when actual < expected', () => {
      expect(evaluate(MongoFieldFilter.lt('age', 30), { age: 25 })).toBe(true);
    });

    it('returns false when actual >= expected', () => {
      expect(evaluate(MongoFieldFilter.lt('age', 25), { age: 25 })).toBe(false);
    });
  });

  describe('$lte', () => {
    it('returns true when actual <= expected', () => {
      expect(evaluate(MongoFieldFilter.lte('age', 25), { age: 25 })).toBe(true);
    });

    it('returns false when actual > expected', () => {
      expect(evaluate(MongoFieldFilter.lte('age', 20), { age: 25 })).toBe(false);
    });
  });

  describe('$in', () => {
    it('returns true when value is in array', () => {
      expect(
        evaluate(MongoFieldFilter.in('status', ['active', 'pending']), { status: 'active' }),
      ).toBe(true);
    });

    it('returns false when value is not in array', () => {
      expect(
        evaluate(MongoFieldFilter.in('status', ['active', 'pending']), { status: 'deleted' }),
      ).toBe(false);
    });

    it('matches objects in array with deep equality', () => {
      expect(
        evaluate(MongoFieldFilter.in('key', [{ email: 1 }, { name: 1 }]), { key: { email: 1 } }),
      ).toBe(true);
    });

    it('rejects objects not in array', () => {
      expect(evaluate(MongoFieldFilter.in('key', [{ email: 1 }]), { key: { name: 1 } })).toBe(
        false,
      );
    });
  });

  describe('$and', () => {
    it('returns true when all conditions match', () => {
      const filter = MongoAndExpr.of([
        MongoFieldFilter.eq('key', { email: 1 }),
        MongoFieldFilter.eq('unique', true),
      ]);
      expect(evaluate(filter, { key: { email: 1 }, unique: true })).toBe(true);
    });

    it('returns false when one condition fails', () => {
      const filter = MongoAndExpr.of([
        MongoFieldFilter.eq('key', { email: 1 }),
        MongoFieldFilter.eq('unique', true),
      ]);
      expect(evaluate(filter, { key: { email: 1 }, unique: false })).toBe(false);
    });
  });

  describe('$or', () => {
    it('returns true when any condition matches', () => {
      const filter = MongoOrExpr.of([
        MongoFieldFilter.eq('name', 'alice'),
        MongoFieldFilter.eq('name', 'bob'),
      ]);
      expect(evaluate(filter, { name: 'bob' })).toBe(true);
    });

    it('returns false when no condition matches', () => {
      const filter = MongoOrExpr.of([
        MongoFieldFilter.eq('name', 'alice'),
        MongoFieldFilter.eq('name', 'bob'),
      ]);
      expect(evaluate(filter, { name: 'charlie' })).toBe(false);
    });
  });

  describe('$not', () => {
    it('inverts a matching filter', () => {
      const filter = MongoFieldFilter.eq('name', 'alice').not();
      expect(evaluate(filter, { name: 'alice' })).toBe(false);
    });

    it('inverts a non-matching filter', () => {
      const filter = MongoFieldFilter.eq('name', 'alice').not();
      expect(evaluate(filter, { name: 'bob' })).toBe(true);
    });
  });

  describe('$exists', () => {
    it('returns true when field exists and checking for existence', () => {
      expect(evaluate(MongoExistsExpr.exists('name'), { name: 'alice' })).toBe(true);
    });

    it('returns false when field missing and checking for existence', () => {
      expect(evaluate(MongoExistsExpr.exists('name'), { other: 'x' })).toBe(false);
    });

    it('returns true when field missing and checking for non-existence', () => {
      expect(evaluate(MongoExistsExpr.notExists('name'), { other: 'x' })).toBe(true);
    });

    it('returns false when field exists and checking for non-existence', () => {
      expect(evaluate(MongoExistsExpr.notExists('name'), { name: 'alice' })).toBe(false);
    });
  });

  describe('dotted field paths', () => {
    it('resolves nested object fields', () => {
      expect(
        evaluate(MongoFieldFilter.eq('options.validator', { $jsonSchema: {} }), {
          options: { validator: { $jsonSchema: {} } },
        }),
      ).toBe(true);
    });

    it('resolves deeply nested fields', () => {
      expect(evaluate(MongoFieldFilter.eq('a.b.c', 42), { a: { b: { c: 42 } } })).toBe(true);
    });

    it('returns false for broken path (missing intermediate)', () => {
      expect(evaluate(MongoFieldFilter.eq('a.b.c', 42), { a: { x: 1 } })).toBe(false);
    });

    it('returns false for broken path (null intermediate)', () => {
      expect(evaluate(MongoFieldFilter.eq('a.b.c', 42), { a: null })).toBe(false);
    });

    it('checks existence through dotted paths', () => {
      expect(evaluate(MongoExistsExpr.exists('a.b'), { a: { b: 1 } })).toBe(true);
    });

    it('checks non-existence through dotted paths', () => {
      expect(evaluate(MongoExistsExpr.notExists('a.b'), { a: { c: 1 } })).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty object document', () => {
      expect(evaluate(MongoFieldFilter.eq('name', 'alice'), {})).toBe(false);
    });

    it('handles empty array value', () => {
      expect(evaluate(MongoFieldFilter.eq('tags', []), { tags: [] })).toBe(true);
    });

    it('handles empty object value', () => {
      expect(evaluate(MongoFieldFilter.eq('data', {}), { data: {} })).toBe(true);
    });

    it('distinguishes undefined from null', () => {
      expect(evaluate(MongoFieldFilter.eq('value', null), { value: undefined })).toBe(false);
    });
  });

  describe('unsupported operations', () => {
    it('throws for MongoExprFilter', () => {
      const expr = MongoExprFilter.of(new MongoAggLiteral(1));
      expect(() => evaluate(expr, {})).toThrow(/not supported/i);
    });

    it('throws for unsupported operator', () => {
      const filter = MongoFieldFilter.of('name', '$regex', 'alice');
      expect(() => evaluate(filter, { name: 'alice' })).toThrow(/Unsupported.*\$regex/);
    });

    it('raises MIGRATION.OPERATION_UNSUPPORTED as a structured error', () => {
      const filter = MongoFieldFilter.of('name', '$regex', 'alice');
      let caught: unknown;
      try {
        evaluate(filter, { name: 'alice' });
      } catch (error) {
        caught = error;
      }
      expect(isStructuredError(caught)).toBe(true);
      expect(caught).toMatchObject({
        code: 'MIGRATION.OPERATION_UNSUPPORTED',
        meta: { operator: '$regex' },
      });
    });
  });
});
