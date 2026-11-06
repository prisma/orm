import { describe, expect, it } from 'vitest';
import { MongoIndex, type MongoIndexInput } from '../src/ir/mongo-index';
import {
  applyPolymorphicScopeToMongoIndex,
  type PolymorphicIndexScope,
} from '../src/polymorphic-index-scope';

const baseIndexFields: MongoIndexInput = {
  name: 'severity_1',
  keys: [{ field: 'severity', direction: 1 }],
  unique: true,
};

const baseIndex = new MongoIndex(baseIndexFields);

function indexWith(overrides: Partial<MongoIndexInput>): MongoIndex {
  return new MongoIndex({ ...baseIndexFields, ...overrides });
}

describe('applyPolymorphicScopeToMongoIndex', () => {
  describe('happy path', () => {
    it('attaches partialFilterExpression when index has none', () => {
      const scope: PolymorphicIndexScope = {
        discriminatorField: 'type',
        discriminatorValue: 'bug',
      };

      const result = applyPolymorphicScopeToMongoIndex(baseIndex, scope);

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.index).not.toBe(baseIndex);
        expect(result.index.partialFilterExpression).toEqual({ type: 'bug' });
        expect(result.index.keys).toBe(baseIndex.keys);
        expect(result.index.unique).toBe(true);
        expect(result.index.name).toBe('severity_1');
      }
    });

    it('AND-merges with existing filter on other fields', () => {
      const index = indexWith({ partialFilterExpression: { active: true, archived: false } });
      const scope: PolymorphicIndexScope = {
        discriminatorField: 'type',
        discriminatorValue: 'bug',
      };

      const result = applyPolymorphicScopeToMongoIndex(index, scope);

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.index.partialFilterExpression).toEqual({
          active: true,
          archived: false,
          type: 'bug',
        });
      }
    });

    it('returns input unchanged when discriminator field already matches (idempotent)', () => {
      const index = indexWith({ partialFilterExpression: { type: 'bug' } });
      const scope: PolymorphicIndexScope = {
        discriminatorField: 'type',
        discriminatorValue: 'bug',
      };

      const result = applyPolymorphicScopeToMongoIndex(index, scope);

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.index).toBe(index);
      }
    });

    it('returns input unchanged when matching alongside other filter keys', () => {
      const index = indexWith({ partialFilterExpression: { type: 'bug', active: true } });
      const scope: PolymorphicIndexScope = {
        discriminatorField: 'type',
        discriminatorValue: 'bug',
      };

      const result = applyPolymorphicScopeToMongoIndex(index, scope);

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.index).toBe(index);
      }
    });

    it('accepts a string discriminator value', () => {
      const result = applyPolymorphicScopeToMongoIndex(baseIndex, {
        discriminatorField: 'kind',
        discriminatorValue: 'article',
      });
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.index.partialFilterExpression).toEqual({ kind: 'article' });
      }
    });

    it('accepts a numeric discriminator value', () => {
      const result = applyPolymorphicScopeToMongoIndex(baseIndex, {
        discriminatorField: 'kind',
        discriminatorValue: 7,
      });
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.index.partialFilterExpression).toEqual({ kind: 7 });
      }
    });

    it('accepts a boolean discriminator value', () => {
      const result = applyPolymorphicScopeToMongoIndex(baseIndex, {
        discriminatorField: 'isPublished',
        discriminatorValue: true,
      });
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.index.partialFilterExpression).toEqual({ isPublished: true });
      }
    });

    it('is a no-op when called twice with the same scope on its own output', () => {
      const scope: PolymorphicIndexScope = {
        discriminatorField: 'type',
        discriminatorValue: 'bug',
      };

      const first = applyPolymorphicScopeToMongoIndex(baseIndex, scope);
      expect(first.kind).toBe('ok');
      if (first.kind !== 'ok') return;

      const second = applyPolymorphicScopeToMongoIndex(first.index, scope);
      expect(second.kind).toBe('ok');
      if (second.kind !== 'ok') return;

      expect(second.index).toBe(first.index);
      expect(second.index.partialFilterExpression).toEqual({ type: 'bug' });
    });
  });

  describe('conflict path', () => {
    it('reports conflict when existing filter sets discriminator to a different string', () => {
      const index = indexWith({ partialFilterExpression: { type: 'feature' } });
      const scope: PolymorphicIndexScope = {
        discriminatorField: 'type',
        discriminatorValue: 'bug',
      };

      const result = applyPolymorphicScopeToMongoIndex(index, scope);

      expect(result.kind).toBe('conflict');
      if (result.kind === 'conflict') {
        expect(result.reason).toMatch(/type/);
        expect(result.reason).toMatch(/feature/);
        expect(result.reason).toMatch(/bug/);
      }
    });

    it('reports conflict when existing filter sets discriminator to a different number', () => {
      const index = indexWith({ partialFilterExpression: { kind: 1 } });
      const result = applyPolymorphicScopeToMongoIndex(index, {
        discriminatorField: 'kind',
        discriminatorValue: 2,
      });

      expect(result.kind).toBe('conflict');
      if (result.kind === 'conflict') {
        expect(result.reason).toMatch(/kind/);
        expect(result.reason).toMatch(/1/);
        expect(result.reason).toMatch(/2/);
      }
    });

    it('uses strict === equality (does not treat 1 and "1" as matching)', () => {
      // value stored as string but scope expects number
      const index = indexWith({ partialFilterExpression: { kind: '1' } });
      const result = applyPolymorphicScopeToMongoIndex(index, {
        discriminatorField: 'kind',
        discriminatorValue: 1,
      });

      expect(result.kind).toBe('conflict');
    });
  });

  describe('runtime scalar guard', () => {
    // The PolymorphicIndexScope type forbids non-scalar discriminator values,
    // but the helper must still defend against bad values arriving via untyped
    // call sites. We cast through the public type to exercise that guard.

    it('rejects null discriminator value', () => {
      // Cast required to bypass the typed-out scalar union and exercise the
      // runtime guard. Narrow scope: the cast is local to this test only.
      const scope = {
        discriminatorField: 'type',
        discriminatorValue: null,
      } as unknown as PolymorphicIndexScope;

      const result = applyPolymorphicScopeToMongoIndex(baseIndex, scope);

      expect(result.kind).toBe('conflict');
      if (result.kind === 'conflict') {
        expect(result.reason).toMatch(/scalar/i);
      }
    });

    it('rejects array discriminator value', () => {
      const scope = {
        discriminatorField: 'type',
        discriminatorValue: ['bug'],
      } as unknown as PolymorphicIndexScope;

      const result = applyPolymorphicScopeToMongoIndex(baseIndex, scope);

      expect(result.kind).toBe('conflict');
      if (result.kind === 'conflict') {
        expect(result.reason).toMatch(/scalar/i);
      }
    });

    it('rejects object discriminator value', () => {
      const scope = {
        discriminatorField: 'type',
        discriminatorValue: { eq: 'bug' },
      } as unknown as PolymorphicIndexScope;

      const result = applyPolymorphicScopeToMongoIndex(baseIndex, scope);

      expect(result.kind).toBe('conflict');
      if (result.kind === 'conflict') {
        expect(result.reason).toMatch(/scalar/i);
      }
    });

    it('rejects undefined discriminator value', () => {
      const scope = {
        discriminatorField: 'type',
        discriminatorValue: undefined,
      } as unknown as PolymorphicIndexScope;

      const result = applyPolymorphicScopeToMongoIndex(baseIndex, scope);

      expect(result.kind).toBe('conflict');
      if (result.kind === 'conflict') {
        expect(result.reason).toMatch(/scalar/i);
      }
    });
  });
});
