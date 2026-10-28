import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  describeMigrationStatement,
  enumValueCoordinateFromJson,
  enumValueCoordinateJson,
  enumValueStatementText,
  fieldStatementText,
  isRenameStatement,
  migrationStatementJson,
  migrationSubjectJson,
  migrationSubjectKey,
  modelDisplayName,
  modelStatementText,
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
    storage: { namespaces: {} },
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

describe('modelStatementText and fieldStatementText', () => {
  it('write a model and a field as a statement names them: with the namespace only when the contract has several', () => {
    const user = { namespaceId: app, model: 'User' };
    expect([
      modelStatementText(contractWith({ app: ['User'] }), user),
      fieldStatementText(contractWith({ app: ['User'] }), { ...user, field: 'age' }),
      modelStatementText(contractWith({ app: ['User'], billing: ['Bill'] }), user),
      fieldStatementText(contractWith({ app: ['User'], billing: ['Bill'] }), {
        ...user,
        field: 'age',
      }),
    ]).toEqual(['User', 'User.age', 'app.User', 'app.User.age']);
  });
});

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

  it('names a model moved to another namespace as moved, with both namespaces', () => {
    const move: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'model',
      from: { namespaceId: asNamespaceId('billing'), model: 'Invoice' },
      to: { namespaceId: asNamespaceId('public'), model: 'Invoice' },
    };

    expect(
      describeMigrationStatement(
        move,
        contractWith({ billing: ['Invoice'] }),
        contractWith({ public: ['Invoice'] }),
      ),
    ).toBe('move model "billing.Invoice" to namespace "public"');
  });

  it('names both namespaces when a model is moved and renamed', () => {
    const moveAndRename: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'model',
      from: { namespaceId: asNamespaceId('billing'), model: 'Invoice' },
      to: { namespaceId: asNamespaceId('finance'), model: 'Bill' },
    };

    expect(
      describeMigrationStatement(
        moveAndRename,
        contractWith({ billing: ['Invoice'] }),
        contractWith({ finance: ['Bill'] }),
      ),
    ).toBe('rename model "billing.Invoice" to "finance.Bill"');
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

  it('names the field a convert or backfill statement names as the destination names it', () => {
    const field = { namespaceId: app, model: 'User', field: 'years' };
    const contracts = [
      contractWith({ app: ['Profile'] }),
      contractWith({ app: ['User'] }),
    ] as const;
    expect([
      describeMigrationStatement({ kind: 'convert', entity: 'field', field }, ...contracts),
      describeMigrationStatement({ kind: 'backfill', entity: 'field', field }, ...contracts),
    ]).toEqual(['convert field "User.years"', 'backfill field "User.years"']);
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

describe('migrationSubjectJson', () => {
  it('leaves namespaceId out for the unbound namespace and keeps it otherwise', () => {
    const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);
    expect([
      migrationSubjectJson({
        kind: 'field',
        namespaceId: unbound,
        model: 'User',
        field: 'name',
      }),
      migrationSubjectJson({ kind: 'model', namespaceId: app, model: 'Legacy' }),
      migrationSubjectJson({ kind: 'storage', name: 'audit_log' }),
    ]).toEqual([
      { kind: 'field', model: 'User', field: 'name' },
      { kind: 'model', namespaceId: 'app', model: 'Legacy' },
      { kind: 'storage', name: 'audit_log' },
    ]);
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
  it('writes a namespace rename with coordinates, as it writes a model rename', () => {
    expect(
      migrationStatementJson({
        kind: 'rename',
        entity: 'namespace',
        from: asNamespaceId('billing'),
        to: asNamespaceId('finance'),
      }),
    ).toEqual({
      kind: 'rename',
      entity: 'namespace',
      from: { namespaceId: 'billing' },
      to: { namespaceId: 'finance' },
    });
  });

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

describe('migrationStatementJson for a statement about one field', () => {
  it('writes the field without the unbound namespace', () => {
    const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);
    expect([
      migrationStatementJson({
        kind: 'convert',
        entity: 'field',
        field: { namespaceId: unbound, model: 'User', field: 'age' },
      }),
      migrationStatementJson({
        kind: 'backfill',
        entity: 'field',
        field: { namespaceId: app, model: 'User', field: 'email' },
      }),
    ]).toEqual([
      { kind: 'convert', entity: 'field', field: { model: 'User', field: 'age' } },
      {
        kind: 'backfill',
        entity: 'field',
        field: { namespaceId: 'app', model: 'User', field: 'email' },
      },
    ]);
  });
});

describe('isRenameStatement', () => {
  it('is true for a model or field rename only', () => {
    const field = { namespaceId: app, model: 'User', field: 'age' };
    expect([
      isRenameStatement(renameModel('Profile', 'User')),
      isRenameStatement(renameField('User', 'User', 'age', 'years')),
      isRenameStatement({ kind: 'convert', entity: 'field', field }),
      isRenameStatement({ kind: 'backfill', entity: 'field', field }),
    ]).toEqual([true, true, false, false]);
  });
});

describe('migrationSubjectKey', () => {
  it('is equal for subjects that name the same thing, whatever their key order', () => {
    const app = asNamespaceId('app');
    expect(
      migrationSubjectKey({ kind: 'field', namespaceId: app, model: 'User', field: 'name' }),
    ).toBe(migrationSubjectKey({ field: 'name', model: 'User', namespaceId: app, kind: 'field' }));
  });

  it('differs between a model, a field and a storage name that share a name', () => {
    const app = asNamespaceId('app');
    const keys = new Set([
      migrationSubjectKey({ kind: 'model', namespaceId: app, model: 'User' }),
      migrationSubjectKey({ kind: 'field', namespaceId: app, model: 'User', field: 'User' }),
      migrationSubjectKey({ kind: 'storage', name: 'User' }),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe('a namespace rename', () => {
  const statement: ResolvedMigrationStatement = {
    kind: 'rename',
    entity: 'namespace',
    from: asNamespaceId('billing'),
    to: asNamespaceId('finance'),
  };

  it('is described by its namespace names', () => {
    const contract = contractWith({ billing: ['Invoice'], app: ['User'] });
    expect(describeMigrationStatement(statement, contract, contract)).toBe(
      'rename namespace "billing" to "finance"',
    );
  });

  it('is a rename statement', () => {
    expect(isRenameStatement(statement)).toBe(true);
  });
});

describe('an enum value rename', () => {
  const statement: ResolvedMigrationStatement = {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: app, enum: 'Status', member: 'ARCHIVED' },
    to: { namespaceId: app, enum: 'Status', member: 'RETIRED' },
  };

  it('is described through its enum, with the namespace only when the contract has several', () => {
    expect(
      describeMigrationStatement(statement, contractWith({ app: [] }), contractWith({ app: [] })),
    ).toBe('rename enum value "Status.ARCHIVED" to "Status.RETIRED"');
    expect(
      describeMigrationStatement(
        statement,
        contractWith({ app: [], billing: [] }),
        contractWith({ app: [], billing: [] }),
      ),
    ).toBe('rename enum value "app.Status.ARCHIVED" to "app.Status.RETIRED"');
  });

  it('is written to JSON with a coordinate on each side', () => {
    expect(migrationStatementJson(statement)).toEqual({
      kind: 'rename',
      entity: 'enumValue',
      from: { namespaceId: 'app', enum: 'Status', member: 'ARCHIVED' },
      to: { namespaceId: 'app', enum: 'Status', member: 'RETIRED' },
    });
  });

  it('is a rename statement', () => {
    expect(isRenameStatement(statement)).toBe(true);
  });
});

describe('an enum value subject', () => {
  const subject = {
    kind: 'enumValue',
    namespaceId: app,
    enum: 'Status',
    member: 'ARCHIVED',
  } as const;

  it('has a key of its own and a JSON coordinate', () => {
    expect(migrationSubjectKey(subject)).not.toBe(
      migrationSubjectKey({ kind: 'field', namespaceId: app, model: 'Status', field: 'ARCHIVED' }),
    );
    expect(migrationSubjectJson(subject)).toEqual({
      kind: 'enumValue',
      namespaceId: 'app',
      enum: 'Status',
      member: 'ARCHIVED',
    });
    expect(
      migrationSubjectJson({ ...subject, namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID) }),
    ).toEqual({ kind: 'enumValue', enum: 'Status', member: 'ARCHIVED' });
  });

  it('is named through its enum in statements', () => {
    expect(enumValueStatementText(contractWith({ app: [] }), subject)).toBe('Status.ARCHIVED');
    expect(enumValueStatementText(contractWith({ app: [], billing: [] }), subject)).toBe(
      'app.Status.ARCHIVED',
    );
  });
});

describe('enum value coordinates in JSON', () => {
  it('leave out the unbound namespace, and read it back', () => {
    const unbound = {
      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
      enum: 'Status',
      member: 'A',
    };
    const named = { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'A' };

    expect(enumValueCoordinateJson(unbound)).toEqual({ enum: 'Status', member: 'A' });
    expect(enumValueCoordinateJson(named)).toEqual(named);
    expect(enumValueCoordinateFromJson(enumValueCoordinateJson(unbound))).toEqual(unbound);
    expect(enumValueCoordinateFromJson(named)).toEqual(named);
  });
});
