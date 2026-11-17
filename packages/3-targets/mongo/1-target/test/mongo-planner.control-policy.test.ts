import { type ControlPolicy, coreHash } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import {
  buildMongoNamespace,
  MongoCollection,
  type MongoCollectionInput,
  type MongoContract,
  MongoStorage,
} from '@internal/mongo-contract';
import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import { MongoSchemaCollection, MongoSchemaIndex, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';

const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const emailIndex = {
  name: 'email_1',
  keys: [{ field: 'email', direction: 1 as const }],
  unique: true,
};

const declared: MongoCollectionInput = {
  indexes: [emailIndex],
  validator: {
    jsonSchema: { bsonType: 'object', properties: { email: { bsonType: 'string' } } },
    validationLevel: 'strict',
    validationAction: 'error',
  },
};

function contractOf(
  collections: Record<string, MongoCollectionInput>,
  defaultControlPolicy?: ControlPolicy,
): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: { namespaces: {} },
    ...(defaultControlPolicy === undefined ? {} : { defaultControlPolicy }),
    storage: new MongoStorage({
      storageHash: coreHash('test-storage'),
      namespaces: {
        __unbound__: buildMongoNamespace({
          id: '__unbound__',
          entries: {
            collection: Object.fromEntries(
              Object.entries(collections).map(([name, input]) => [
                name,
                new MongoCollection(input),
              ]),
            ),
          },
        }),
      },
    }),
  } as unknown as MongoContract;
}

function liveCollection(name: string, indexes: readonly MongoSchemaIndex[] = []) {
  return new MongoSchemaCollection({ name, indexes: [...indexes] });
}

function planOf(
  contract: MongoContract,
  schema: MongoSchemaIR,
  fromContract: MongoContract | null = null,
): { readonly commands: readonly string[]; readonly warnings: readonly unknown[] } {
  const result = new MongoMigrationPlanner().plan({
    contract,
    schema,
    policy: ALL_CLASSES_POLICY,
    fromContract,
    origin: null,
    statements: [],
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return {
    commands: (result.plan.operations as readonly MongoMigrationPlanOperation[]).map(
      (op) => `${op.execute[0]?.command.kind} ${op.execute[0]?.command.collection}`,
    ),
    warnings: result.warnings ?? [],
  };
}

function plannedCommands(contract: MongoContract, schema: MongoSchemaIR): readonly string[] {
  return planOf(contract, schema).commands;
}

describe('MongoMigrationPlanner under a collection control policy', () => {
  it('plans every change to a managed collection', () => {
    const contract = contractOf({ users: { ...declared, control: 'managed' } });

    expect(
      plannedCommands(
        contract,
        new MongoSchemaIR([liveCollection('users')], { fromDatabase: false }),
      ),
    ).toEqual(['createIndex users', 'collMod users']);
  });

  it.each(['external', 'observed'] as const)(
    'changes nothing in an existing %s collection',
    (control) => {
      const contract = contractOf({ users: { ...declared, control } });
      const live = liveCollection('users', [
        new MongoSchemaIndex({ name: 'legacy_1', keys: [{ field: 'legacy', direction: 1 }] }),
      ]);

      expect(plannedCommands(contract, new MongoSchemaIR([live], { fromDatabase: false }))).toEqual(
        [],
      );
    },
  );

  it.each(['external', 'observed'] as const)(
    'does not create an absent %s collection',
    (control) => {
      const contract = contractOf({ users: { ...declared, control } });

      expect(plannedCommands(contract, new MongoSchemaIR([], { fromDatabase: false }))).toEqual([]);
    },
  );

  it('creates an absent tolerated collection with its indexes', () => {
    const contract = contractOf({ audit: { ...declared, control: 'tolerated' } });

    expect(plannedCommands(contract, new MongoSchemaIR([], { fromDatabase: false }))).toEqual([
      'createCollection audit',
      'createIndex audit',
    ]);
  });

  it('changes nothing in an existing tolerated collection', () => {
    const contract = contractOf({ audit: { ...declared, control: 'tolerated' } });

    expect(
      plannedCommands(
        contract,
        new MongoSchemaIR([liveCollection('audit')], { fromDatabase: false }),
      ),
    ).toEqual([]);
  });

  it('does not drop a collection the contract leaves out under an external default policy', () => {
    const contract = contractOf({}, 'external');

    expect(
      plannedCommands(
        contract,
        new MongoSchemaIR([liveCollection('legacy')], { fromDatabase: false }),
      ),
    ).toEqual([]);
  });

  it('keeps every collection of an external-default contract unchanged, even one declared managed', () => {
    const contract = contractOf({ users: { ...declared, control: 'managed' } }, 'external');

    expect(
      planOf(contract, new MongoSchemaIR([liveCollection('users')], { fromDatabase: false })),
    ).toEqual({
      commands: [],
      warnings: [
        {
          kind: 'controlPolicySuppressedCall',
          summary:
            "control policy suppressed: Create index email_1 on users (email:1) — collection \"users\" has effective control 'external' but declared 'managed'",
          meta: { controlPolicy: 'external', declaredControlPolicy: 'managed' },
        },
        {
          kind: 'controlPolicySuppressedCall',
          summary:
            "control policy suppressed: Add validator on users — collection \"users\" has effective control 'external' but declared 'managed'",
          meta: { controlPolicy: 'external', declaredControlPolicy: 'managed' },
        },
      ],
    });
  });

  it('warns about each change a policy leaves out of an existing external collection', () => {
    const contract = contractOf({ users: { indexes: [emailIndex], control: 'external' } });
    const live = liveCollection('users', [
      new MongoSchemaIndex({ name: 'legacy_1', keys: [{ field: 'legacy', direction: 1 }] }),
    ]);

    expect(planOf(contract, new MongoSchemaIR([live], { fromDatabase: false })).warnings).toEqual([
      {
        kind: 'controlPolicySuppressedCall',
        summary:
          'control policy suppressed: Drop index legacy_1 on users (legacy:1) — collection "users" has effective control \'external\'',
        meta: { controlPolicy: 'external', declaredControlPolicy: 'external' },
      },
      {
        kind: 'controlPolicySuppressedCall',
        summary:
          'control policy suppressed: Create index email_1 on users (email:1) — collection "users" has effective control \'external\'',
        meta: { controlPolicy: 'external', declaredControlPolicy: 'external' },
      },
    ]);
  });

  it.each(['external', 'observed'] as const)(
    'does not drop a collection the origin contract declares %s when the new contract leaves it out',
    (control) => {
      const fromContract = contractOf({ legacy: { control } });

      expect(
        planOf(
          contractOf({}),
          new MongoSchemaIR([liveCollection('legacy')], { fromDatabase: false }),
          fromContract,
        ),
      ).toEqual({
        commands: [],
        warnings: [
          {
            kind: 'controlPolicySuppressedCall',
            summary: `control policy suppressed: Drop collection legacy — collection "legacy" has effective control '${control}'`,
            meta: { controlPolicy: control, declaredControlPolicy: control },
          },
        ],
      });
    },
  );
});
