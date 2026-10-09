import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { PslBlockSpecDescriptor } from '@internal/psl-parser';
import { entityRef, optional, str, structBlock } from '@internal/psl-parser';
import type { ResolvedPslModelRefs } from '@internal/sql-contract/entity-handle-lowering-hook';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

interface GuardBlock {
  readonly name: string;
  readonly namespaceId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly resolvedModelRefs?: ResolvedPslModelRefs;
}

const guardDescriptor = {
  kind: 'pslBlock',
  keyword: 'guard_rule',
  discriminator: 'guard',
  name: { required: true },
  spec: () =>
    structBlock({
      parameters: {
        target: { type: entityRef({ kind: 'model' }), documentation: 'The guarded model.' },
        reason: { type: optional(str()), documentation: 'Why the guard exists.' },
        level: { type: optional(str()), documentation: 'How strict the guard is.' },
      },
    }),
} satisfies PslBlockSpecDescriptor;

const authoringContributions: AuthoringContributions = {
  type: postgresScalarAuthoringTypes,
  entityTypes: {
    ...testEnumEntityContributions,
    guard: {
      kind: 'entity',
      discriminator: 'guard',
      output: {
        factory: (block: GuardBlock) => ({
          guardName: block.name,
          lexicalNamespaceId: block.namespaceId,
          table: block.resolvedModelRefs?.['target']?.tableName,
          reason: block.values['reason'],
          level: block.values['level'],
        }),
      },
    },
  },
  pslBlockDescriptors: { enum: testEnumPslBlockDescriptor, guard_rule: guardDescriptor },
  dataTypes: fixtureDataTypeSupport.entries,
  valueObjectStorageType: 'Jsonb',
};

function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    authoringContributions,
    ...fixtureInterpreterTypes,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
}

function contractOf(schema: string) {
  const result = interpret(schema);
  if (!result.ok) {
    throw new Error(
      `The schema did not interpret: ${JSON.stringify(result.failure.diagnostics, null, 2)}`,
    );
  }
  return result.value;
}

function lines(...parts: string[]): string {
  return parts.join('\n');
}

function modelOf(schema: string, namespaceId: string, name: string) {
  const contract = contractOf(schema);
  const model = contract.domain.namespaces[namespaceId]?.models[name];
  const table = (contract.storage as SqlStorage).namespaces[namespaceId]?.entries.table?.[name];
  if (model === undefined || table === undefined) throw new Error(`no model "${name}"`);
  return { model, table };
}

describe('a schema that uses a mixin gives the contract of the same schema written inline', () => {
  it('for a model mixin with fields, defaults and a model attribute', () => {
    const withMixin = lines(
      'model mixin Timestamps {',
      '  createdAt DateTime @default(now())',
      '  updatedAt DateTime @default(now())',
      '  @@index([createdAt])',
      '}',
      'model User {',
      '  id Int @id',
      '  +Timestamps',
      '  email String @unique',
      '}',
      'model Post {',
      '  id Int @id',
      '  +Timestamps',
      '}',
    );
    const inline = lines(
      'model User {',
      '  id Int @id',
      '  createdAt DateTime @default(now())',
      '  updatedAt DateTime @default(now())',
      '  @@index([createdAt])',
      '  email String @unique',
      '}',
      'model Post {',
      '  id Int @id',
      '  createdAt DateTime @default(now())',
      '  updatedAt DateTime @default(now())',
      '  @@index([createdAt])',
      '}',
    );

    expect(contractOf(withMixin)).toEqual(contractOf(inline));
  });

  it('for a type mixin included in a composite type', () => {
    const model = ['model Place {', '  id Int @id', '  home Address', '}'];
    const withMixin = lines(
      'type mixin Geo {',
      '  lat Float',
      '  lng Float?',
      '}',
      'type Address {',
      '  street String',
      '  +Geo',
      '  city String',
      '}',
      ...model,
    );
    const inline = lines(
      'type Address {',
      '  street String',
      '  lat Float',
      '  lng Float?',
      '  city String',
      '}',
      ...model,
    );

    expect(contractOf(withMixin)).toEqual(contractOf(inline));
  });

  it('for an enum mixin included in an enum', () => {
    const model = ['model User {', '  id Int @id', '  role Role @default(USER)', '}'];
    const withMixin = lines(
      'enum mixin BaseRoles {',
      '  ADMIN = "admin"',
      '  USER = "user"',
      '}',
      'enum Role {',
      '  @@type("pg/text@1")',
      '  +BaseRoles',
      '  GUEST = "guest"',
      '}',
      ...model,
    );
    const inline = lines(
      'enum Role {',
      '  @@type("pg/text@1")',
      '  ADMIN = "admin"',
      '  USER = "user"',
      '  GUEST = "guest"',
      '}',
      ...model,
    );

    expect(contractOf(withMixin)).toEqual(contractOf(inline));
  });

  it('for a mixin of a key = value block an extension defines', () => {
    const model = ['model Widget {', '  id Int @id', '  @@map("widgets")', '}'];
    const withMixin = lines(
      ...model,
      'guard_rule mixin Strict {',
      '  reason = "audit"',
      '  level = "strict"',
      '}',
      'guard_rule widget_write {',
      '  target = Widget',
      '  +Strict',
      '}',
    );
    const inline = lines(
      ...model,
      'guard_rule widget_write {',
      '  target = Widget',
      '  reason = "audit"',
      '  level = "strict"',
      '}',
    );
    const contract = contractOf(withMixin);

    expect(contract).toEqual(contractOf(inline));
    expect(
      (contract.storage as SqlStorage).namespaces['public']?.entries['guard']?.['widget_write'],
    ).toEqual({
      guardName: 'widget_write',
      lexicalNamespaceId: 'public',
      table: 'widgets',
      reason: 'audit',
      level: 'strict',
    });
  });

  it('for a model whose id names a field that a mixin provides', () => {
    const withMixin = lines(
      'model mixin Tenant {',
      '  tenantId Int',
      '}',
      'model Order {',
      '  +Tenant',
      '  id Int',
      '  @@id([tenantId, id])',
      '}',
    );
    const inline = lines(
      'model Order {',
      '  tenantId Int',
      '  id Int',
      '  @@id([tenantId, id])',
      '}',
    );
    const contract = contractOf(withMixin);

    expect(contract).toEqual(contractOf(inline));
    expect(modelOf(withMixin, 'public', 'Order').table.primaryKey?.columns).toEqual([
      'tenantId',
      'id',
    ]);
  });

  it('for a mixin in one namespace included from another, with a relation to a model of its own namespace', () => {
    const billingUser = ['  model User {', '    id Int @id', '    name String', '  }'];
    const authUser = ['  model User {', '    id Int @id', '    invoices billing.Invoice[]', '  }'];
    const withMixin = lines(
      'namespace auth {',
      ...authUser,
      '  model mixin Owned {',
      '    ownerId Int',
      '    owner User @relation(fields: [ownerId], references: [id])',
      '  }',
      '}',
      'namespace billing {',
      ...billingUser,
      '  model Invoice {',
      '    id Int @id',
      '    +auth.Owned',
      '  }',
      '}',
    );
    const inline = lines(
      'namespace auth {',
      ...authUser,
      '}',
      'namespace billing {',
      ...billingUser,
      '  model Invoice {',
      '    id Int @id',
      '    ownerId Int',
      '    owner auth.User @relation(fields: [ownerId], references: [id])',
      '  }',
      '}',
    );
    const { model, table } = modelOf(withMixin, 'billing', 'Invoice');

    expect(contractOf(withMixin)).toEqual(contractOf(inline));
    expect(model.relations['owner']).toMatchObject({ to: { namespace: 'auth', model: 'User' } });
    expect(table.foreignKeys).toMatchObject([
      { target: { namespaceId: 'auth', tableName: 'User' } },
    ]);
  });
});

describe('the fields of a model follow the position of the inclusion', () => {
  const mixin = ['model mixin Timestamps {', '  createdAt DateTime', '  updatedAt DateTime', '}'];

  it.each([
    [
      'first',
      ['  +Timestamps', '  id Int @id', '  email String'],
      ['createdAt', 'updatedAt', 'id', 'email'],
    ],
    [
      'in the middle',
      ['  id Int @id', '  +Timestamps', '  email String'],
      ['id', 'createdAt', 'updatedAt', 'email'],
    ],
    [
      'last',
      ['  id Int @id', '  email String', '  +Timestamps'],
      ['id', 'email', 'createdAt', 'updatedAt'],
    ],
  ])('with the inclusion %s', (_position, body, expected) => {
    const { model, table } = modelOf(
      lines(...mixin, 'model User {', ...body, '}'),
      'public',
      'User',
    );

    expect(Object.keys(model.fields)).toEqual(expected);
    expect(Object.keys(table.columns)).toEqual(expected);
  });
});

describe('an interpreter error on a member of a mixin', () => {
  it('is reported once for each including model, at the member in the mixin', () => {
    const schema = lines(
      'model mixin Counted {',
      '  count Int @default("many")',
      '}',
      'model A {',
      '  id Int @id',
      '  +Counted',
      '}',
      'model B {',
      '  id Int @id',
      '  +Counted',
      '}',
    );
    const result = interpret(schema);
    const diagnostics = result.ok ? [] : result.failure.diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining('"A.count"'),
      expect.stringContaining('"B.count"'),
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.span?.start.line)).toEqual([2, 2]);
    expect(diagnostics[0]?.span).toEqual(diagnostics[1]?.span);
  });
});
