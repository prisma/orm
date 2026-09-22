/**
 * The `sql()` stage refuses a model whose named storage objects reuse a literal
 * name, by resolving to a builder whose sql spec is `never`. The names only
 * reach the check when `constraints.index` and `constraints.foreignKey` keep
 * them literal, so these cases pin that inference as much as the check itself.
 */
import { expectTypeOf, test } from 'vitest';
import { field, model } from '../src/contract-builder';
import type { ContractModelBuilder } from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';

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
