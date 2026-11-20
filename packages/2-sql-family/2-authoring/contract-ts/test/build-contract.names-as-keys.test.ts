import type { Contract } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
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

describe('inherited names elsewhere', () => {
  it('keeps a table and a model named "constructor" and a column named "toString"', () => {
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
    const sqlFamilyPack: FamilyPackRef<'sql'> = {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
    };
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          Post: model('Post', {
            fields: { id: field.column(int4).id() },
            relations: { author: rel.belongsTo('constructor', { from: 'id', to: 'id' }) },
          }),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MODEL_UNKNOWN' }));
  });
});

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
      'namespace',
      () => build({ namespaces: ['__proto__'], models: [userModel({ namespaceId: '__proto__' })] }),
      /^The namespace of table "users" /,
    ],
    [
      'table',
      () => build({ models: [userModel({ tableName: '__proto__' })] }),
      /^A table in namespace "public" /,
    ],
    [
      'column',
      () =>
        build({ models: [userModel({ fields: [column('id'), column('label', '__proto__')] })] }),
      /^A column of table "users" /,
    ],
    [
      'model',
      () => build({ models: [userModel({ modelName: '__proto__' })] }),
      /^A model in namespace "public" /,
    ],
    [
      'field',
      () =>
        build({ models: [userModel({ fields: [column('id'), column('__proto__', 'label')] })] }),
      /^A field of model "User" /,
    ],
    [
      'relation',
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
      /^A relation of model "User" /,
    ],
    [
      'enum',
      () =>
        build({
          enums: Object.fromEntries([['__proto__', enumType('__proto__', text, member('A', 'a'))]]),
        }),
      /^An enum in namespace "public" /,
    ],
    [
      'value object',
      () => build({ valueObjects: [{ name: '__proto__', fields: [column('street')] }] }),
      /^A value object is/,
    ],
    [
      'value object field',
      () =>
        build({
          valueObjects: [{ name: 'Address', fields: [column('__proto__')] }],
          models: [userModel({ fields: [column('id'), valueObjectField] })],
        }),
      /^A field of value object "Address" /,
    ],
    [
      'database type',
      () =>
        build({
          databaseTypes: Object.fromEntries([
            ['__proto__', { kind: 'codec-instance', codecId: 'pg/text@1', typeParams: {} }],
          ]),
        }),
      /^A database type is/,
    ],
    [
      'attached entity',
      () =>
        build({
          attachedEntities: { public: { widget: Object.fromEntries([['__proto__', {}]]) } },
        }),
      /^A "widget" entity in namespace "public" /,
    ],
    [
      'field of a TypeScript model',
      () => model('User', { fields: Object.fromEntries([['__proto__', field.column(int4)]]) }),
      /^A field of model "User" /,
    ],
  ];

  it.each(cases)('refuses a %s named "__proto__"', (_kind, run, kindInMessage) => {
    const { added, error } = propertiesAddedBy(run);
    expect(added).toEqual([]);
    expect(error).toMatchObject({
      code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
      message: expect.stringMatching(kindInMessage),
    });
    expect(error).toMatchObject({ message: expect.stringContaining('is named "__proto__"') });
  });
});
