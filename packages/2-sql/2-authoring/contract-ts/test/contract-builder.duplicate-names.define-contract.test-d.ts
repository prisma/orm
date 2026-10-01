/**
 * `defineContract` refuses a model that reuses a name among its id, uniques,
 * indexes and foreign keys, in both the object form and the callback form. This
 * covers a stage spec that resolved to `never` and a clash no stage saw: inline
 * field names, or a relation added after `sql()`.
 */
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { test } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract, field, model, rel } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const family: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const target: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const base = { family, target, createNamespace: createTestSqlNamespace };

const textColumn = columnDescriptor('pg/text@1');
const fields = {
  id: field.column(textColumn).id({ name: 'user_pkey' }),
  email: field.column(textColumn),
  invitedById: field.column(textColumn),
};

const cleanUser = model('User', {
  fields: { ...fields, email: field.column(textColumn).unique({ name: 'user_email_key' }) },
})
  .attributes(({ fields: refs, constraints }) => ({
    uniques: [constraints.unique(refs.invitedById, { name: 'user_invited_by_key' })],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'user',
    indexes: [constraints.index([cols.invitedById], { name: 'user_invited_by_idx' })],
  }));

const duplicateInSql = model('User', { fields }).sql(({ cols, constraints }) => ({
  table: 'user',
  indexes: [
    constraints.index([cols.email], { name: 'user_idx' }),
    constraints.index([cols.invitedById], { name: 'user_idx' }),
  ],
}));

const duplicateInAttributes = model('User', { fields }).attributes(
  ({ fields: refs, constraints }) => ({
    uniques: [
      constraints.unique(refs.email, { name: 'user_key' }),
      constraints.unique(refs.invitedById, { name: 'user_key' }),
    ],
  }),
);

const duplicateInlineUniques = model('User', {
  fields: {
    ...fields,
    email: field.column(textColumn).unique({ name: 'user_key' }),
    invitedById: field.column(textColumn).unique({ name: 'user_key' }),
  },
});

const relationAddedAfterSql = model('Post', {
  fields: {
    id: field.column(textColumn).id(),
    authorId: field.column(textColumn),
  },
})
  .sql(({ cols, constraints }) => ({
    table: 'post',
    indexes: [constraints.index([cols.authorId], { name: 'post_author' })],
  }))
  .relations({
    author: rel
      .belongsTo('User', { from: 'authorId', to: 'id' })
      .sql({ fk: { name: 'post_author' } }),
  });

test('a model with distinct names is accepted', () => {
  defineContract({ ...base, models: { User: cleanUser } });
  defineContract(base, () => ({ models: { User: cleanUser } }));
});

test('a duplicate name in sql() is rejected', () => {
  // @ts-expect-error the sql() stage resolved to never
  defineContract({ ...base, models: { User: duplicateInSql } });
  // @ts-expect-error the sql() stage resolved to never
  defineContract(base, () => ({ models: { User: duplicateInSql } }));
});

test('a duplicate name in attributes() is rejected', () => {
  // @ts-expect-error the attributes() stage resolved to never
  defineContract({ ...base, models: { User: duplicateInAttributes } });
  // @ts-expect-error the attributes() stage resolved to never
  defineContract(base, () => ({ models: { User: duplicateInAttributes } }));
});

test('two inline uniques with the same name are rejected without any stage call', () => {
  // @ts-expect-error two fields declare the unique name user_key
  defineContract({ ...base, models: { User: duplicateInlineUniques } });
  // @ts-expect-error two fields declare the unique name user_key
  defineContract(base, () => ({ models: { User: duplicateInlineUniques } }));
});

test('a relation foreign key added after sql() and reusing an index name is rejected', () => {
  // @ts-expect-error the relation foreign key reuses the index name post_author
  defineContract({ ...base, models: { Post: relationAddedAfterSql } });
});
