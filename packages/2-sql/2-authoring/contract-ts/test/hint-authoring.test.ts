import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract, field, type ModelLike, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const sqlFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4Column = columnDescriptor('pg/int4@1');
const fields = { id: field.column(int4Column).id() };

function build(models: Record<string, ModelLike>, namespaces?: readonly string[]) {
  return defineContract({
    family: sqlFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...(namespaces === undefined ? {} : { namespaces }),
    models,
  });
}

function emittedHints(models: Record<string, ModelLike>, namespaces?: readonly string[]) {
  return JSON.parse(JSON.stringify(build(models, namespaces))).hints;
}

function expectHintInvalid(models: Record<string, ModelLike>, message: string) {
  expect(() => build(models)).toThrow(
    expect.objectContaining({ code: 'CONTRACT.HINT_INVALID', message }),
  );
}

describe('model rename hint in the TypeScript DSL', () => {
  it('emits a was keyed by the table name the naming convention gives', () => {
    expect(
      emittedHints({ User: model('User', { fields }).sql({ hint: { was: 'Profile' } }) }),
    ).toEqual({ namespaces: { public: { tables: { User: { was: 'Profile' } } } } });
  });

  it('emits a was keyed by the explicit table name', () => {
    expect(
      emittedHints({
        User: model('User', { fields }).sql({ table: 'users', hint: { was: 'profiles' } }),
      }),
    ).toEqual({ namespaces: { public: { tables: { users: { was: 'profiles' } } } } });
  });

  it('emits no hints key without a hint', () => {
    expect(
      JSON.parse(JSON.stringify(build({ User: model('User', { fields }) }))),
    ).not.toHaveProperty('hints');
  });

  it('rejects an empty was', () => {
    expectHintInvalid(
      { User: model('User', { fields }).sql({ hint: { was: '' } }) },
      '@@hint(was:) must name the previous storage name.',
    );
  });

  it('rejects a was equal to the model table name', () => {
    expectHintInvalid(
      { User: model('User', { fields }).sql({ table: 'users', hint: { was: 'users' } }) },
      '@@hint(was: "users") names the table\'s current name; the hint is spent, remove it.',
    );
  });

  it('rejects a was naming a table another model declares', () => {
    expectHintInvalid(
      {
        User: model('User', { fields }).sql({ hint: { was: 'Post' } }),
        Post: model('Post', { fields }),
      },
      '@@hint(was: "Post") on model User names a table this contract also declares through model Post; a rename cannot apply while both exist.',
    );
  });

  it('rejects two models in one namespace claiming the same was', () => {
    expectHintInvalid(
      {
        User: model('User', { fields }).sql({ hint: { was: 'Profile' } }),
        Account: model('Account', { fields }).sql({ hint: { was: 'Profile' } }),
      },
      'Models User and Account both claim to have been "Profile".',
    );
  });

  it('accepts the same was in two namespaces and a was naming a table of another namespace', () => {
    expect(
      emittedHints(
        {
          User: model('User', { fields }).sql({ hint: { was: 'Profile' } }),
          Account: model('Account', { namespace: 'auth', fields }).sql({
            hint: { was: 'Profile' },
          }),
          Profile: model('Profile', { namespace: 'billing', fields }),
        },
        ['public', 'auth', 'billing'],
      ),
    ).toEqual({
      namespaces: {
        auth: { tables: { Account: { was: 'Profile' } } },
        public: { tables: { User: { was: 'Profile' } } },
      },
    });
  });

  it('matches a was containing a dot verbatim as one table name', () => {
    expect(
      emittedHints({
        User: model('User', { fields }).sql({ hint: { was: 'legacy.users' } }),
        Users: model('Users', { fields }).sql({ table: 'users' }),
      }),
    ).toEqual({ namespaces: { public: { tables: { User: { was: 'legacy.users' } } } } });
  });

  it('carries the model and the was in the error meta', () => {
    expect(() =>
      build({ User: model('User', { fields }).sql({ table: 'users', hint: { was: 'users' } }) }),
    ).toThrow(expect.objectContaining({ meta: { model: 'User', was: 'users' } }));
  });
});
