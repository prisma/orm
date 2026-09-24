/**
 * The `attributes()` and `sql()` stages refuse a model whose named storage
 * objects reuse a literal name, by resolving to a builder whose spec for the
 * stage that introduced the clash is `never`. The names only reach the check
 * when `constraints.unique`, `constraints.index` and `constraints.foreignKey`
 * keep them literal, so these cases pin that inference as much as the check.
 */
import { expectTypeOf, test } from 'vitest';
import { field, model } from '../src/contract-builder';
import type { ContractModelBuilder } from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';

type AttributesSpecOf<Builder> =
  Builder extends ContractModelBuilder<
    infer _ModelName,
    infer _Fields,
    infer _Relations,
    infer AttributesSpec,
    infer _SqlSpec,
    infer _IndexTypes,
    infer _SpaceId
  >
    ? AttributesSpec
    : never;

type SqlSpecOf<Builder> =
  Builder extends ContractModelBuilder<
    infer _ModelName,
    infer _Fields,
    infer _Relations,
    infer _Attributes,
    infer SqlSpec,
    infer _IndexTypes,
    infer _SpaceId
  >
    ? SqlSpec
    : never;

type IsNever<T> = [T] extends [never] ? true : false;

const textColumn = columnDescriptor('pg/text@1');
const fields = {
  id: field.column(textColumn).id({ name: 'user_pkey' }),
  email: field.column(textColumn),
  invitedById: field.column(textColumn),
};

const fieldsWithoutInlineId = {
  id: field.column(textColumn),
  email: field.column(textColumn),
  invitedById: field.column(textColumn),
};

test('distinct index names are accepted', () => {
  const user = model('User', { fields }).sql(({ cols, constraints }) => ({
    table: 'user',
    indexes: [
      constraints.index([cols.email], { name: 'user_email_idx' }),
      constraints.index([cols.invitedById], { name: 'user_invited_by_idx' }),
    ],
  }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<false>();
});

test('two indexes with the same name are rejected', () => {
  const user = model('User', { fields }).sql(({ cols, constraints }) => ({
    table: 'user',
    indexes: [
      constraints.index([cols.email], { name: 'user_idx' }),
      constraints.index([cols.invitedById], { name: 'user_idx' }),
    ],
  }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('an expression index reusing a fields index name is rejected', () => {
  const user = model('User', { fields }).sql(({ cols, constraints }) => ({
    table: 'user',
    indexes: [
      constraints.index([cols.email], { name: 'user_idx' }),
      constraints.index({ expression: 'lower(email)', name: 'user_idx' }),
    ],
  }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('an index reusing the primary key name is rejected', () => {
  const user = model('User', { fields }).sql(({ cols, constraints }) => ({
    table: 'user',
    indexes: [constraints.index([cols.email], { name: 'user_pkey' })],
  }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('two foreign keys with the same name are rejected', () => {
  const user = model('User', { fields }).sql(({ cols, constraints }) => ({
    table: 'user',
    foreignKeys: [
      constraints.foreignKey(cols.invitedById, constraints.ref('User', 'id'), { name: 'user_fk' }),
      constraints.foreignKey(cols.email, constraints.ref('User', 'id'), { name: 'user_fk' }),
    ],
  }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('distinct unique and index names are accepted in either stage order', () => {
  const attributesFirst = model('User', { fields })
    .attributes(({ fields: refs, constraints }) => ({
      uniques: [constraints.unique(refs.email, { name: 'user_email_key' })],
    }))
    .sql(({ cols, constraints }) => ({
      table: 'user',
      indexes: [constraints.index([cols.invitedById], { name: 'user_invited_by_idx' })],
    }));
  expectTypeOf<IsNever<AttributesSpecOf<typeof attributesFirst>>>().toEqualTypeOf<false>();
  expectTypeOf<IsNever<SqlSpecOf<typeof attributesFirst>>>().toEqualTypeOf<false>();

  const sqlFirst = model('User', { fields })
    .sql(({ cols, constraints }) => ({
      table: 'user',
      indexes: [constraints.index([cols.invitedById], { name: 'user_invited_by_idx' })],
    }))
    .attributes(({ fields: refs, constraints }) => ({
      uniques: [constraints.unique(refs.email, { name: 'user_email_key' })],
    }));
  expectTypeOf<IsNever<AttributesSpecOf<typeof sqlFirst>>>().toEqualTypeOf<false>();
  expectTypeOf<IsNever<SqlSpecOf<typeof sqlFirst>>>().toEqualTypeOf<false>();
});

test('two uniques with the same name are rejected', () => {
  const user = model('User', { fields }).attributes(({ fields: refs, constraints }) => ({
    uniques: [
      constraints.unique(refs.email, { name: 'user_key' }),
      constraints.unique(refs.invitedById, { name: 'user_key' }),
    ],
  }));
  expectTypeOf<IsNever<AttributesSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('a unique reusing the primary key name is rejected', () => {
  const user = model('User', { fields }).attributes(({ fields: refs, constraints }) => ({
    uniques: [constraints.unique(refs.email, { name: 'user_pkey' })],
  }));
  expectTypeOf<IsNever<AttributesSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('a unique reusing an index name is rejected when attributes come first', () => {
  const user = model('User', { fields })
    .attributes(({ fields: refs, constraints }) => ({
      uniques: [constraints.unique(refs.email, { name: 'user_key' })],
    }))
    .sql(({ cols, constraints }) => ({
      table: 'user',
      indexes: [constraints.index([cols.invitedById], { name: 'user_key' })],
    }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('a unique reusing an index name is rejected when sql comes first', () => {
  const user = model('User', { fields })
    .sql(({ cols, constraints }) => ({
      table: 'user',
      indexes: [constraints.index([cols.invitedById], { name: 'user_key' })],
    }))
    .attributes(({ fields: refs, constraints }) => ({
      uniques: [constraints.unique(refs.email, { name: 'user_key' })],
    }));
  expectTypeOf<IsNever<AttributesSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('a unique reusing a foreign key name is rejected', () => {
  const user = model('User', { fields })
    .attributes(({ fields: refs, constraints }) => ({
      uniques: [constraints.unique(refs.email, { name: 'user_fk' })],
    }))
    .sql(({ cols, constraints }) => ({
      table: 'user',
      foreignKeys: [
        constraints.foreignKey(cols.invitedById, constraints.ref('User', 'id'), {
          name: 'user_fk',
        }),
      ],
    }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('distinct attributes-declared id and index names are accepted', () => {
  const user = model('User', { fields: fieldsWithoutInlineId })
    .attributes(({ fields: refs, constraints }) => ({
      id: constraints.id([refs.id], { name: 'user_pkey' }),
    }))
    .sql(({ cols, constraints }) => ({
      table: 'user',
      indexes: [constraints.index([cols.email], { name: 'user_email_idx' })],
    }));
  expectTypeOf<IsNever<AttributesSpecOf<typeof user>>>().toEqualTypeOf<false>();
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<false>();
});

test('an index reusing an attributes-declared id name is rejected', () => {
  const user = model('User', { fields: fieldsWithoutInlineId })
    .attributes(({ fields: refs, constraints }) => ({
      id: constraints.id([refs.id], { name: 'user_pkey' }),
    }))
    .sql(({ cols, constraints }) => ({
      table: 'user',
      indexes: [constraints.index([cols.email], { name: 'user_pkey' })],
    }));
  expectTypeOf<IsNever<SqlSpecOf<typeof user>>>().toEqualTypeOf<true>();
});

test('a unique reusing an attributes-declared id name is rejected', () => {
  const user = model('User', { fields: fieldsWithoutInlineId }).attributes(
    ({ fields: refs, constraints }) => ({
      id: constraints.id(refs.id, { name: 'user_pkey' }),
      uniques: [constraints.unique(refs.email, { name: 'user_pkey' })],
    }),
  );
  expectTypeOf<IsNever<AttributesSpecOf<typeof user>>>().toEqualTypeOf<true>();
});
