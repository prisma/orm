import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  describeMigrationStatement,
  migrationStatementJson,
  modelDisplayName,
  type ResolvedMigrationStatement,
} from '../src/control/migration-statements';
import { UNBOUND_NAMESPACE_ID } from '../src/ir/namespace';

function contractWith(models: Readonly<Record<string, readonly string[]>>): ContractWithDomain {
  return {
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(models).map(([namespaceId, names]) => [
          namespaceId,
          {
            models: Object.fromEntries(
              names.map((name) => [name, { fields: {}, relations: {}, storage: {} }]),
            ),
          },
        ]),
      ),
    },
  };
}

const app = asNamespaceId('app');

function renameModel(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: app, model: from },
    to: { namespaceId: app, model: to },
  };
}

function renameField(
  fromModel: string,
  toModel: string,
  from: string,
  to: string,
): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespaceId: app, model: fromModel, field: from },
    to: { namespaceId: app, model: toModel, field: to },
  };
}

describe('describeMigrationStatement', () => {
  it('names models without their namespace when the contract has one namespace', () => {
    expect(
      describeMigrationStatement(
        renameModel('Profile', 'User'),
        contractWith({ app: ['Profile'] }),
        contractWith({ app: ['User'] }),
      ),
    ).toBe('rename model "Profile" to "User"');
  });

  it('names models with their namespace when the contract has several', () => {
    expect(
      describeMigrationStatement(
        renameModel('Profile', 'User'),
        contractWith({ app: ['Profile'], billing: ['Bill'] }),
        contractWith({ app: ['User'], billing: ['Bill'] }),
      ),
    ).toBe('rename model "app.Profile" to "app.User"');
  });

  it('names the old field through the model as the destination names it', () => {
    expect(
      describeMigrationStatement(
        renameField('Profile', 'User', 'name', 'fullName'),
        contractWith({ app: ['Profile'] }),
        contractWith({ app: ['User'] }),
      ),
    ).toBe('rename field "User.name" to "User.fullName"');
  });

  it('names a model in the unbound namespace without the internal namespace id', () => {
    const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);
    expect(
      describeMigrationStatement(
        {
          kind: 'rename',
          entity: 'model',
          from: { namespaceId: unbound, model: 'Profile' },
          to: { namespaceId: unbound, model: 'User' },
        },
        contractWith({ [UNBOUND_NAMESPACE_ID]: ['Profile'], billing: ['Bill'] }),
        contractWith({ [UNBOUND_NAMESPACE_ID]: ['User'], billing: ['Bill'] }),
      ),
    ).toBe('rename model "Profile" to "User"');
  });
});

describe('modelDisplayName', () => {
  it('qualifies a model with its namespace, except in the unbound namespace', () => {
    expect([
      modelDisplayName({ namespaceId: app, model: 'User' }),
      modelDisplayName({ namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: 'User' }),
    ]).toEqual(['app.User', 'User']);
  });
});

describe('migrationStatementJson', () => {
  it('leaves namespaceId out for the unbound namespace and keeps it otherwise', () => {
    const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);
    expect([
      migrationStatementJson({
        kind: 'rename',
        entity: 'field',
        from: { namespaceId: unbound, model: 'User', field: 'name' },
        to: { namespaceId: unbound, model: 'User', field: 'fullName' },
      }),
      migrationStatementJson(renameModel('Profile', 'User')),
    ]).toEqual([
      {
        kind: 'rename',
        entity: 'field',
        from: { model: 'User', field: 'name' },
        to: { model: 'User', field: 'fullName' },
      },
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: 'app', model: 'Profile' },
        to: { namespaceId: 'app', model: 'User' },
      },
    ]);
  });
});
