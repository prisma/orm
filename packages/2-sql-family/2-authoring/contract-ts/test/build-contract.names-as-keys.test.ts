import type { Contract } from '@internal/contract/types';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import type {
  EntityHandleLoweringInput,
  LoweredPackEntity,
  PackEntityHandle,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import {
  buildSqlContractFromDefinition,
  defineContract,
  field,
  model,
  rel,
} from '../src/contract-builder';
import type { ContractDefinition, FieldNode, ModelNode } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4 = { codecId: 'pg/int4@1' } as const;
const text = { codecId: 'pg/text@1' } as const;

function column(fieldName: string, columnName = fieldName): FieldNode {
  return { fieldName, columnName, descriptor: int4, nullable: false, many: false };
}

function userModel(overrides: Partial<ModelNode> = {}): ModelNode {
  return {
    modelName: 'User',
    tableName: 'users',
    fields: [column('id')],
    id: { columns: ['id'] },
    ...overrides,
  };
}

function build(definition: Partial<ContractDefinition>): Contract<SqlStorage> {
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [userModel()],
      ...definition,
    },
    testTypeLookups.codecLookup,
    testTypeLookups.dataTypeLookup,
  ) as Contract<SqlStorage>;
}

const watchedObjects = {
  Object,
  'Object.prototype': Object.prototype,
  'Object.prototype.toString': Object.prototype.toString,
};

/** Runs `run` and returns the properties it added to `Object`, `Object.prototype` and `Object.prototype.toString`, removing them again. */
function propertiesAddedBy(run: () => unknown): { added: string[]; error: unknown } {
  const before = new Map(
    Object.entries(watchedObjects).map(([label, target]) => [label, Reflect.ownKeys(target)]),
  );
  let error: unknown;
  try {
    run();
  } catch (thrown) {
    error = thrown;
  }
  const added: string[] = [];
  for (const [label, target] of Object.entries(watchedObjects)) {
    for (const key of Reflect.ownKeys(target)) {
      if (before.get(label)?.includes(key)) continue;
      added.push(`${label}.${String(key)}`);
      Reflect.deleteProperty(target, key);
    }
  }
  return { added, error };
}

function ownEntry(record: unknown, ...path: string[]): unknown {
  let current = record;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = Reflect.get(current, key);
  }
  return current;
}

describe.each(['constructor', 'toString'])('a namespace named "%s"', (namespaceId) => {
  const run = () => build({ namespaces: [namespaceId], models: [userModel({ namespaceId })] });

  it('holds the table and the model', () => {
    const { added, error } = propertiesAddedBy(() => {
      const contract = run();
      expect(
        ownEntry(contract.storage.namespaces, namespaceId, 'entries', 'table', 'users'),
      ).toBeDefined();
      expect(ownEntry(contract.domain.namespaces, namespaceId, 'models', 'User')).toBeDefined();
    });
    expect(error).toBeUndefined();
    expect(added).toEqual([]);
  });

  it('survives a JSON round trip', () => {
    const { added, error } = propertiesAddedBy(() => {
      const json: unknown = JSON.parse(JSON.stringify(run()));
      expect(
        ownEntry(json, 'storage', 'namespaces', namespaceId, 'entries', 'table', 'users'),
      ).toEqual(expect.objectContaining({ columns: expect.anything() }));
      expect(ownEntry(json, 'domain', 'namespaces', namespaceId, 'models', 'User')).toBeDefined();
    });
    expect(error).toBeUndefined();
    expect(added).toEqual([]);
  });

  it('loads back through validation', () => {
    const { added, error } = propertiesAddedBy(() => {
      const json: unknown = JSON.parse(JSON.stringify(run()));
      const loaded = validateSqlContractFully<Contract<SqlStorage>>(json);
      expect(
        ownEntry(loaded.storage.namespaces, namespaceId, 'entries', 'table', 'users'),
      ).toBeDefined();
    });
    expect(error).toBeUndefined();
    expect(added).toEqual([]);
  });
});

const sqlFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

function buildTypeScript(input: Readonly<Record<string, unknown>>): unknown {
  return defineContract({
    ...testTypeLookups,
    family: sqlFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...input,
  } as Parameters<typeof defineContract>[0]);
}

const gadgetAuthoring = {
  entityTypes: {
    gadget: {
      kind: 'entity',
      discriminator: 'gadget',
      output: { factory: (input: { readonly name: string }) => ({ ...input }) },
    },
  },
  lowerEntityHandles: (input: EntityHandleLoweringInput): LoweredPackEntity[] =>
    input.handles.map(() => ({
      namespaceId: input.defaultNamespaceId,
      entityKind: 'gadget',
      key: '__proto__',
      entity: {},
    })),
} as const;

const gadgetPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'gadget-demo',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: gadgetAuthoring,
};

const gadgetHandle: PackEntityHandle = { entityKind: 'gadget' };

describe('inherited names elsewhere', () => {
  it('does not refuse a table and a model named "constructor" or a column named "toString"', () => {
    const { added, error } = propertiesAddedBy(() => {
      const contract = build({
        models: [
          userModel({
            modelName: 'constructor',
            tableName: 'constructor',
            fields: [column('id'), column('label', 'toString')],
          }),
        ],
      });
      expect(
        ownEntry(
          contract.storage.namespaces,
          'public',
          'entries',
          'table',
          'constructor',
          'columns',
          'toString',
        ),
      ).toBeDefined();
      expect(ownEntry(contract.domain.namespaces, 'public', 'models', 'constructor')).toBeDefined();
    });
    expect(error).toBeUndefined();
    expect(added).toEqual([]);
  });

  it('reports a relation to an undeclared model named "constructor" as unknown', () => {
    expect(() =>
      buildTypeScript({
        models: {
          Post: model('Post', {
            fields: { id: field.column(int4).id() },
            relations: { author: rel.belongsTo('constructor', { from: 'id', to: 'id' }) },
          }),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MODEL_UNKNOWN' }));
  });

  it('reports a relation from an undeclared field named "constructor" as unknown', () => {
    expect(() =>
      buildTypeScript({
        models: {
          User: model('User', { fields: { id: field.column(int4).id() } }),
          Post: model('Post', {
            fields: { id: field.column(int4).id() },
            relations: { author: rel.belongsTo('User', { from: 'constructor', to: 'id' }) },
          }),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.FIELD_UNKNOWN' }));
  });
});

function expectRefused(run: () => unknown, messageStart: RegExp): void {
  const { added, error } = propertiesAddedBy(run);
  expect(added).toEqual([]);
  expect(error).toMatchObject({
    code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
    message: expect.stringMatching(messageStart),
  });
}

describe('a name that cannot be a key', () => {
  const valueObjectField = {
    fieldName: 'home',
    columnName: 'home',
    descriptor: { codecId: 'pg/jsonb@1' },
    valueObjectName: 'Address',
    nullable: false,
  } as const;

  const cases: readonly (readonly [string, () => unknown, RegExp])[] = [
    [
      'a namespace holding a model',
      () => build({ namespaces: ['__proto__'], models: [userModel({ namespaceId: '__proto__' })] }),
      /^The namespace of table "users" is named "__proto__"/,
    ],
    [
      'a namespace that is only declared',
      () => build({ namespaces: ['__proto__'] }),
      /^A namespace is named "__proto__"/,
    ],
    [
      'a table',
      () => build({ models: [userModel({ tableName: '__proto__' })] }),
      /^A table in namespace "public" is named "__proto__"/,
    ],
    [
      'a column',
      () =>
        build({ models: [userModel({ fields: [column('id'), column('label', '__proto__')] })] }),
      /^A column of table "users" is named "__proto__"/,
    ],
    [
      'a model',
      () => build({ models: [userModel({ modelName: '__proto__' })] }),
      /^A model in namespace "public" is named "__proto__"/,
    ],
    [
      'a field',
      () =>
        build({ models: [userModel({ fields: [column('id'), column('__proto__', 'label')] })] }),
      /^A field of model "User" is named "__proto__"/,
    ],
    [
      'a relation',
      () =>
        build({
          models: [
            userModel({
              relations: [
                {
                  fieldName: '__proto__',
                  toModel: 'User',
                  toTable: 'users',
                  cardinality: '1:N',
                  on: {
                    parentTable: 'users',
                    parentColumns: ['id'],
                    childTable: 'users',
                    childColumns: ['id'],
                  },
                },
              ],
            }),
          ],
        }),
      /^A relation of model "User" is named "__proto__"/,
    ],
    [
      'an enum',
      () =>
        build({
          enums: Object.fromEntries([['__proto__', enumType('__proto__', text, member('A', 'a'))]]),
        }),
      /^An enum in namespace "public" is named "__proto__"/,
    ],
    [
      'a value object',
      () => build({ valueObjects: [{ name: '__proto__', fields: [column('street')] }] }),
      /^A value object is named "__proto__"/,
    ],
    [
      'a value object field',
      () =>
        build({
          valueObjects: [{ name: 'Address', fields: [column('__proto__')] }],
          models: [userModel({ fields: [column('id'), valueObjectField] })],
        }),
      /^A field of value object "Address" is named "__proto__"/,
    ],
    [
      'a database type',
      () =>
        build({
          databaseTypes: Object.fromEntries([
            ['__proto__', { kind: 'codec-instance', codecId: 'pg/text@1', typeParams: {} }],
          ]),
        }),
      /^A database type is named "__proto__"/,
    ],
    [
      'an attached entity',
      () =>
        build({
          attachedEntities: { public: { widget: Object.fromEntries([['__proto__', {}]]) } },
        }),
      /^A "widget" entity in namespace "public" is named "__proto__"/,
    ],
    [
      'an entity collected from a column',
      () =>
        build({
          models: [
            userModel({
              fields: [
                column('id'),
                {
                  ...column('mood'),
                  descriptor: {
                    ...int4,
                    entityRef: { entityKind: 'widget', entityName: '__proto__', entity: {} },
                  },
                },
              ],
            }),
          ],
        }),
      /^A "widget" entity in namespace "public" is named "__proto__"/,
    ],
    [
      'a pack entity handle key',
      () => buildTypeScript({ extensions: { gadgetDemo: gadgetPack }, entities: [gadgetHandle] }),
      /^A "gadget" entity in namespace "public" is named "__proto__"/,
    ],
    [
      'a field of a TypeScript model',
      () => model('User', { fields: Object.fromEntries([['__proto__', field.column(int4)]]) }),
      /^A field of model "User" is named "__proto__"/,
    ],
    [
      'a model key in a TypeScript contract',
      () =>
        buildTypeScript({
          models: Object.fromEntries([
            ['__proto__', model('Foo', { fields: { id: field.column(int4).id() } })],
          ]),
        }),
      /^A model is named "__proto__"/,
    ],
    [
      'a database type key in a TypeScript contract',
      () =>
        buildTypeScript({
          databaseTypes: Object.fromEntries([
            ['__proto__', { kind: 'codec-instance', codecId: 'pg/text@1', typeParams: {} }],
          ]),
        }),
      /^A database type is named "__proto__"/,
    ],
  ];

  it.each(cases)('refuses %s named "__proto__"', (_kind, run, messageStart) => {
    expectRefused(run, messageStart);
  });
});

describe('a "__proto__" key written in an object literal', () => {
  const literalMessage = 'is written under the key "__proto__" in an object literal';
  const cases: readonly (readonly [string, () => unknown, RegExp])[] = [
    [
      'the fields of a model',
      () =>
        model('User', {
          fields: { id: field.column(int4).id(), __proto__: field.column(text) },
        }),
      /^A field of model "User" is written under the key "__proto__"/,
    ],
    [
      'the relations of a model',
      () =>
        model('User', {
          fields: { id: field.column(int4).id() },
          relations: { __proto__: rel.hasMany('User', { by: 'id' }) },
        }),
      /^A relation of model "User" is written under the key "__proto__"/,
    ],
    [
      'relations added to a model',
      () =>
        model('User', { fields: { id: field.column(int4).id() } }).relations({
          __proto__: rel.hasMany('User', { by: 'id' }),
        }),
      /^A relation of model "User" is written under the key "__proto__"/,
    ],
    [
      'the models of a contract',
      () =>
        buildTypeScript({
          models: { __proto__: model('Foo', { fields: { id: field.column(int4).id() } }) },
        }),
      /^A model is written under the key "__proto__"/,
    ],
    [
      'the enums of a contract',
      () =>
        buildTypeScript({
          enums: { __proto__: enumType('Mood', text, member('A', 'a')) },
        }),
      /^An enum is written under the key "__proto__"/,
    ],
    [
      'the database types of a contract',
      () =>
        buildTypeScript({
          databaseTypes: {
            __proto__: { kind: 'codec-instance', codecId: 'pg/text@1', typeParams: {} },
          },
        }),
      /^A database type is written under the key "__proto__"/,
    ],
    [
      'the extensions of a contract',
      () => buildTypeScript({ extensions: { __proto__: gadgetPack } }),
      /^An extension pack is written under the key "__proto__"/,
    ],
  ];

  it.each(cases)('is refused in %s', (_where, run, messageStart) => {
    expectRefused(run, messageStart);
    expect(propertiesAddedBy(run).error).toMatchObject({
      message: expect.stringContaining(literalMessage),
    });
  });
});
