import { MONGO_INDEX_OPTION_KEYS } from '@internal/mongo-contract';
import type { MongoFilterExpr } from '@internal/mongo-query-ast/control';
import {
  keysToKeySpec,
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  MongoNotExpr,
} from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { collMod, createIndex } from '../src/core/migrations/migration-factories';

describe('createIndex postcheck', () => {
  const keys = [{ field: 'email', direction: 1 as const }];

  it('checks every option the planner tells indexes apart by in the postcheck', () => {
    const op = createIndex('users', keys, {
      unique: true,
      partialFilterExpression: { email: { $exists: true } },
      collation: { locale: 'en', strength: 2 },
    });

    expect(op.postcheck[0]!.filter).toEqual(
      MongoAndExpr.of([
        MongoFieldFilter.eq('key', keysToKeySpec(keys)),
        MongoFieldFilter.eq('unique', true),
        new MongoNotExpr(MongoFieldFilter.eq('sparse', true)),
        MongoExistsExpr.notExists('expireAfterSeconds'),
        MongoFieldFilter.eq('partialFilterExpression', { email: { $exists: true } }),
        MongoExistsExpr.notExists('wildcardProjection'),
        MongoFieldFilter.eq('collation.locale', 'en'),
        MongoFieldFilter.eq('collation.strength', 2),
      ]),
    );
  });

  it('checks a text index as MongoDB lists it, with every weight and language', () => {
    const op = createIndex(
      'posts',
      [
        { field: 'category', direction: 1 },
        { field: 'title', direction: 'text' },
        { field: 'body', direction: 'text' },
      ],
      { weights: { title: 10 } },
    );

    expect(op.postcheck[0]!.filter).toEqual(
      MongoAndExpr.of([
        MongoFieldFilter.eq('key', { category: 1, _fts: 'text', _ftsx: 1 }),
        new MongoNotExpr(MongoFieldFilter.eq('unique', true)),
        new MongoNotExpr(MongoFieldFilter.eq('sparse', true)),
        MongoExistsExpr.notExists('expireAfterSeconds'),
        MongoExistsExpr.notExists('partialFilterExpression'),
        MongoExistsExpr.notExists('wildcardProjection'),
        MongoExistsExpr.notExists('collation'),
        MongoFieldFilter.eq('weights', { body: 1, title: 10 }),
        MongoFieldFilter.eq('default_language', 'english'),
        MongoFieldFilter.eq('language_override', 'language'),
      ]),
    );
  });
});

function fieldsOf(filter: MongoFilterExpr): string[] {
  switch (filter.kind) {
    case 'and':
    case 'or':
      return filter.exprs.flatMap(fieldsOf);
    case 'not':
      return fieldsOf(filter.expr);
    case 'field':
    case 'exists':
      return [filter.field];
    default:
      return [];
  }
}

describe('createIndex postcheck options', () => {
  it('checks every index option the verifier compares', () => {
    const textKeys = [{ field: 'title', direction: 'text' as const }];
    const fields = fieldsOf(
      createIndex('posts', textKeys, { collation: { locale: 'en' } }).postcheck[0]!.filter,
    );

    expect(
      MONGO_INDEX_OPTION_KEYS.filter(
        (option) => !fields.some((field) => field === option || field.startsWith(`${option}.`)),
      ),
    ).toEqual([]);
  });
});

describe('collMod postcheck', () => {
  it('compares the whole validator in the postcheck when it is not only a $jsonSchema', () => {
    const validator = { status: { $in: ['active', 'archived'] } };
    const op = collMod('users', { validator, validationLevel: 'strict' });

    expect(op.postcheck[0]!.filter).toEqual(
      MongoAndExpr.of([
        MongoFieldFilter.eq('name', 'users'),
        MongoFieldFilter.eq('options.validationLevel', 'strict'),
        MongoFieldFilter.eq('options.validator', validator),
      ]),
    );
  });
});
