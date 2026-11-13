import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const EXTENSION_NOTE =
  'upgrade-instructions/pending/mongo-prepare-orm-reads/extension/instructions.md';

const matcher = (id: string) => (content: string) =>
  detectionPatterns(EXTENSION_NOTE, id).some((pattern) => pattern.test(content));

describe('the mongo-collection-has-prepared detection', () => {
  const matches = matcher('mongo-collection-has-prepared');

  it('matches a hand-written collection, and not one taken from the client or a parameter', () => {
    expect([
      matches("const users: MongoCollection<Contract, 'User'> = {\n  limit,\n};"),
      matches("const users: MongoCollection<Contract, 'User', Record<string, true>> = { limit };"),
      matches('class FakeUsers implements MongoCollection {}'),
      matches("const users: MongoCollection<Contract, 'User'> = db.orm.users;"),
      matches("function read(users: MongoCollection<Contract, 'User'>) {}"),
    ]).toEqual([true, true, true, false, false]);
  });
});

describe('the mongo-prepare-member-removed detection', () => {
  const matches = matcher('mongo-prepare-member-removed');

  it('matches MongoPrepareMember, and not the prepared handle types', () => {
    expect([
      matches('const prepare: MongoPrepareMember = runtime;'),
      matches("import type { MongoPrepareMember } from '@prisma/orm-mongo/family-runtime';"),
      matches('let statement: MongoPreparedStatement<Params, Row>;'),
      matches('let rows: MongoPreparedRowQuery<Params, Row[]>;'),
    ]).toEqual([true, true, false, false]);
  });
});

describe('the mongo-where-filter-takes-placeholders detection', () => {
  const matches = matcher('mongo-where-filter-takes-placeholders');

  it('matches code that names MongoWhereFilter, and not other filter types', () => {
    expect([
      matches("function label(filter: MongoWhereFilter<Contract, 'User'>) {}"),
      matches('const filter = MongoFieldFilter.eq(name, value);'),
      matches('type Filter = MongoWhereFilterLike;'),
    ]).toEqual([true, false, false]);
  });
});

describe('the compile-mongo-query-has-no-row-type detection', () => {
  const matches = matcher('compile-mongo-query-has-no-row-type');

  it('matches a call with a type argument, and not one without', () => {
    expect([
      matches('const plan = compileMongoQuery<UserRow>(collection, state, hash, model, storage);'),
      matches('const plan = compileMongoQuery(collection, state, hash, model, storage);'),
    ]).toEqual([true, false]);
  });
});
