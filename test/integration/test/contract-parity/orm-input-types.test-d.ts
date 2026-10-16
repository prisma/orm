import postgres from '@internal/postgres/runtime';
import { contractFromJson as postgresContractFromJson } from '@internal/postgres/static';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson as sqliteContractFromJson } from '@internal/sqlite/static';
import type { Char, Numeric, Varchar } from '@internal/target-postgres/codec-types';
import { describe, expectTypeOf, test } from 'vitest';
import { contract as postgresScalarSource } from '../planner-golden/fixtures/postgres/contract';
import type { Contract as PostgresScalarEmitted } from '../planner-golden/fixtures/postgres/generated/contract';
import postgresScalarJson from '../planner-golden/fixtures/postgres/generated/contract.json' with {
  type: 'json',
};
import { contract as sqliteScalarSource } from '../planner-golden/fixtures/sqlite/contract';
import type { Contract as SqliteScalarEmitted } from '../planner-golden/fixtures/sqlite/generated/contract';
import sqliteScalarJson from '../planner-golden/fixtures/sqlite/generated/contract.json' with {
  type: 'json',
};
import { contract as postgresParitySource } from './fixtures/postgres/contract';
import type { Contract as PostgresParityEmitted } from './fixtures/postgres/generated/contract';
import postgresParityJson from './fixtures/postgres/generated/contract.json' with { type: 'json' };
import { contract as sqliteParitySource } from './fixtures/sqlite/contract';
import type { Contract as SqliteParityEmitted } from './fixtures/sqlite/generated/contract';
import sqliteParityJson from './fixtures/sqlite/generated/contract.json' with { type: 'json' };

declare const idFromRequest: string;

const postgresScalar = {
  emitted: postgres({
    contract: postgresContractFromJson<PostgresScalarEmitted>(postgresScalarJson),
  }),
  built: postgres({ contract: postgresScalarSource }),
};
const postgresParity = {
  emitted: postgres({
    contract: postgresContractFromJson<PostgresParityEmitted>(postgresParityJson),
  }),
  built: postgres({ contract: postgresParitySource }),
};
const sqliteScalar = {
  emitted: sqlite({ contract: sqliteContractFromJson<SqliteScalarEmitted>(sqliteScalarJson) }),
  built: sqlite({ contract: sqliteScalarSource }),
};
const sqliteParity = {
  emitted: sqlite({ contract: sqliteContractFromJson<SqliteParityEmitted>(sqliteParityJson) }),
  built: sqlite({ contract: sqliteParitySource }),
};

describe('Postgres: filters and writes on a column with type parameters take its input type', () => {
  test('emitted contract', async () => {
    const Scalar = postgresScalar.emitted.orm.public.Scalar;
    await Scalar.where({ varcharLength: 'x', charLength: 'abcde' }).first();
    await Scalar.where((s) => s.varcharLength.eq('x')).first();
    await Scalar.where((s) => s.numericPrecisionScale.gt('1.5')).first();
    await Scalar.where((s) => s.charLength.in(['abcde'])).first();
    await Scalar.where({ id: 1 }).update({ varcharLength: 'y', numericPrecision: '10' });
    await Scalar.where({ id: 1 }).updateAll({ bitLength: '10101010' });
  });

  test('defineContract contract', async () => {
    const Scalar = postgresScalar.built.orm.public.Scalar;
    await Scalar.where({ varcharLength: 'x', charLength: 'abcde' }).first();
    await Scalar.where((s) => s.varcharLength.eq('x')).first();
    await Scalar.where((s) => s.numericPrecisionScale.gt('1.5')).first();
    await Scalar.where((s) => s.charLength.in(['abcde'])).first();
    await Scalar.where({ id: 1 }).update({ varcharLength: 'y', numericPrecision: '10' });
    await Scalar.where({ id: 1 }).updateAll({ bitLength: '10101010' });
  });

  test('reads keep the output type with its type parameters', async () => {
    const emitted = await postgresScalar.emitted.orm.public.Scalar.select(
      'varcharLength',
      'charLength',
      'numericPrecisionScale',
    ).first();
    const built = await postgresScalar.built.orm.public.Scalar.select(
      'varcharLength',
      'charLength',
      'numericPrecisionScale',
    ).first();
    type Row = {
      varcharLength: Varchar<255>;
      charLength: Char<5>;
      numericPrecisionScale: Numeric<10, 2>;
    } | null;
    expectTypeOf(emitted).toEqualTypeOf<Row>();
    expectTypeOf(built).toEqualTypeOf<Row>();
  });
});

describe('Postgres: a generated id is filtered, created and connected with a plain string', () => {
  test('emitted contract', async () => {
    const orm = postgresParity.emitted.orm.public;
    await orm.Generated.where({ id: idFromRequest }).first();
    await orm.Generated.where((g) => g.ulid.eq(idFromRequest)).first();
    await orm.Generated.whereUnique({ id: idFromRequest }).first();
    await orm.Post.create({ authorId: idFromRequest, title: 'Hello' });
    await orm.Post.createAll([{ id: idFromRequest, authorId: idFromRequest, title: 'Hello' }]);
    await orm.Post.upsert({
      create: { authorId: idFromRequest, title: 'Hello' },
      update: { authorId: idFromRequest },
    });
    await orm.User.where({ id: idFromRequest }).update({ externalId: idFromRequest });
  });

  test('defineContract contract', async () => {
    const orm = postgresParity.built.orm.public;
    await orm.Generated.where({ id: idFromRequest }).first();
    await orm.Generated.where((g) => g.ulid.eq(idFromRequest)).first();
    await orm.Generated.whereUnique({ id: idFromRequest }).first();
    await orm.Post.create({ authorId: idFromRequest, title: 'Hello' });
    await orm.Post.createAll([{ id: idFromRequest, authorId: idFromRequest, title: 'Hello' }]);
    await orm.Post.upsert({
      create: { authorId: idFromRequest, title: 'Hello' },
      update: { authorId: idFromRequest },
    });
    await orm.User.where({ id: idFromRequest }).update({ externalId: idFromRequest });
  });

  test('reads keep the output type with its type parameters', async () => {
    const emitted = await postgresParity.emitted.orm.public.Generated.select('id', 'ulid').first();
    const built = await postgresParity.built.orm.public.Generated.select('id', 'ulid').first();
    expectTypeOf(emitted).toEqualTypeOf<{ id: Char<36>; ulid: Char<26> } | null>();
    expectTypeOf(built).toEqualTypeOf<{ id: Char<36>; ulid: Char<26> } | null>();
  });
});

describe('SQLite: filters and writes take each field input type', () => {
  test('emitted contract', async () => {
    await sqliteScalar.emitted.orm.Scalar.where({ varcharLength: 'x' }).first();
    await sqliteScalar.emitted.orm.Scalar.where((s) => s.charLength.eq('x')).first();
    await sqliteScalar.emitted.orm.Scalar.where({ id: 1 }).update({ varcharLength: 'y' });
    await sqliteParity.emitted.orm.Generated.where({ id: idFromRequest }).first();
    await sqliteParity.emitted.orm.Post.create({ authorId: idFromRequest, title: 'Hello' });
  });

  test('defineContract contract', async () => {
    await sqliteScalar.built.orm.Scalar.where({ varcharLength: 'x' }).first();
    await sqliteScalar.built.orm.Scalar.where((s) => s.charLength.eq('x')).first();
    await sqliteScalar.built.orm.Scalar.where({ id: 1 }).update({ varcharLength: 'y' });
    await sqliteParity.built.orm.Generated.where({ id: idFromRequest }).first();
    await sqliteParity.built.orm.Post.create({ authorId: idFromRequest, title: 'Hello' });
  });
});
