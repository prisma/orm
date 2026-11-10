import { coreHash, type JsonValue } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { planOriginOf } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import {
  buildMongoNamespace,
  MongoCollection,
  type MongoCollectionOptions,
  type MongoCollectionOptionsInput,
  type MongoContract,
  type MongoIndex,
  type MongoIndexInput,
  MongoStorage,
  type MongoValidator,
  type MongoValidatorInput,
} from '@internal/mongo-contract';
import type {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import { CollModCall, CreateIndexCall } from '../src/core/migrations/op-factory-call';
import type { PlannerProducedMongoMigration } from '../src/exports/control';

const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const ADDITIVE_ONLY_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive'],
};

type MongoCollectionData = {
  readonly indexes?: readonly (MongoIndex | MongoIndexInput)[];
  readonly validator?: MongoValidator | MongoValidatorInput;
  readonly options?: MongoCollectionOptions | MongoCollectionOptionsInput;
};

function makeStorageCollection(data: MongoCollectionData): MongoCollection {
  return new MongoCollection(data);
}

function makeContract(
  collections: Record<string, MongoCollectionData>,
  storageHash = 'test-storage',
): MongoContract {
  const builtCollections: Record<string, MongoCollection> = {};
  for (const [name, data] of Object.entries(collections)) {
    builtCollections[name] = makeStorageCollection(data);
  }
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: builtCollections },
        },
      },
    },
  } as unknown as MongoContract;
}

function emptyIR(): MongoSchemaIR {
  return new MongoSchemaIR([], { fromDatabase: false });
}

function irWithCollection(name: string, indexes: MongoSchemaIndex[]): MongoSchemaIR {
  return new MongoSchemaIR([new MongoSchemaCollection({ name, indexes })], { fromDatabase: false });
}

function ascIndex(
  field: string,
  options?: { unique?: boolean; sparse?: boolean },
): MongoSchemaIndex {
  return new MongoSchemaIndex({
    name: `${field}_1`,
    keys: [{ field, direction: 1 }],
    unique: options?.unique,
    sparse: options?.sparse,
  });
}

function planSuccess(
  planner: MongoMigrationPlanner,
  contract: MongoContract,
  schema: MongoSchemaIR,
  policy = ALL_CLASSES_POLICY,
): PlannerProducedMongoMigration {
  const result = planner.plan({
    contract,
    schema,
    policy,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('Expected success');
  return result.plan as PlannerProducedMongoMigration;
}

describe('MongoMigrationPlanner', () => {
  const planner = new MongoMigrationPlanner();

  describe('index diffing', () => {
    it('emits createIndex when destination has an index origin lacks', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());

      expect(plan.operations).toHaveLength(1);
      const op = plan.operations[0] as MongoMigrationPlanOperation;
      expect(op.operationClass).toBe('additive');
      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('createIndex');
      const cmd = op.execute[0]!.command as CreateIndexCommand;
      expect(cmd.collection).toBe('users');
      expect(cmd.keys).toEqual([{ field: 'email', direction: 1 }]);
    });

    it('emits dropIndex when origin has an index destination lacks', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);

      expect(plan.operations).toHaveLength(1);
      const op = plan.operations[0] as MongoMigrationPlanOperation;
      expect(op.operationClass).toBe('widening');
      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('dropIndex');
      const cmd = op.execute[0]!.command as DropIndexCommand;
      expect(cmd.collection).toBe('users');
    });

    it('emits no operations when indexes are identical', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('treats indexes with same keys but different name as equivalent (no-op)', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('includes sparse flag in index lookup key', () => {
      const contract = makeContract({
        users: {
          indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], sparse: true }],
        },
      });
      const origin = irWithCollection('users', [ascIndex('email', { sparse: true })]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('treats indexes with same keys but different options as different', () => {
      const contract = makeContract({
        users: {
          indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true }],
        },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);

      expect(plan.operations).toHaveLength(2);
      const drop = plan.operations[0] as MongoMigrationPlanOperation;
      const create = plan.operations[1] as MongoMigrationPlanOperation;
      expect(drop.operationClass).toBe('widening');
      expect(create.operationClass).toBe('additive');
    });

    it('treats indexes with same keys but different TTL as different', () => {
      const contract = makeContract({
        sessions: {
          indexes: [
            {
              name: 'createdAt_1',
              keys: [{ field: 'createdAt', direction: 1 }],
              expireAfterSeconds: 3600,
            },
          ],
        },
      });
      const origin = irWithCollection('sessions', [
        new MongoSchemaIndex({
          name: 'createdAt_1',
          keys: [{ field: 'createdAt', direction: 1 }],
          expireAfterSeconds: 7200,
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('treats indexes with same keys but different partialFilterExpression as different', () => {
      const contract = makeContract({
        items: {
          indexes: [
            {
              name: 'status_1',
              keys: [{ field: 'status', direction: 1 }],
              partialFilterExpression: { active: true },
            },
          ],
        },
      });
      const origin = irWithCollection('items', [
        new MongoSchemaIndex({
          name: 'status_1',
          keys: [{ field: 'status', direction: 1 }],
          partialFilterExpression: { active: false },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('handles multiple indexes on same collection', () => {
      const contract = makeContract({
        users: {
          indexes: [
            { name: 'email_1', keys: [{ field: 'email', direction: 1 }] },
            { name: 'name_1', keys: [{ field: 'name', direction: 1 }] },
          ],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(2);
      expect(plan.operations.every((op) => op.operationClass === 'additive')).toBe(true);
    });

    it('handles multiple collections', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
        posts: { indexes: [{ name: 'title_1', keys: [{ field: 'title', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(2);
    });

    it('drops all indexes and the collection when collection removed from destination', () => {
      const contract = makeContract({});
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            indexes: [ascIndex('email'), ascIndex('name')],
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(3);
      expect(plan.operations.map((op) => op.operationClass)).toEqual([
        'widening',
        'widening',
        'destructive',
      ]);
      expect(plan.operations[2]!.id).toBe('collection.users.drop');
    });

    it('handles empty origin (all creates)', () => {
      const contract = makeContract({
        users: {
          indexes: [
            { name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true },
            { name: 'name_1', keys: [{ field: 'name', direction: 1 }] },
          ],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(2);
      expect(plan.operations.every((op) => op.operationClass === 'additive')).toBe(true);
    });
  });

  describe('ordering', () => {
    it('orders drops before creates', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'name_1', keys: [{ field: 'name', direction: 1 }] }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);

      expect(plan.operations).toHaveLength(2);
      expect(plan.operations[0]!.operationClass).toBe('widening');
      expect(plan.operations[1]!.operationClass).toBe('additive');
    });

    it('orders operations deterministically by collection then keys', () => {
      const contract = makeContract({
        beta: { indexes: [{ name: 'x_1', keys: [{ field: 'x', direction: 1 }] }] },
        alpha: { indexes: [{ name: 'y_1', keys: [{ field: 'y', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());

      expect(plan.operations).toHaveLength(2);
      expect(plan.operations[0]!.id).toContain('alpha');
      expect(plan.operations[1]!.id).toContain('beta');
    });
  });

  describe('policy gating', () => {
    it('returns conflicts when the policy disallows an index drop', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ADDITIVE_ONLY_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.kind).toBe('policy-violation');
    });

    it('allows additive operations with additive-only policy', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR(), ADDITIVE_ONLY_POLICY);
      expect(plan.operations).toHaveLength(1);
    });

    it('returns all disallowed operations as separate conflicts', () => {
      const contract = makeContract({});
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            indexes: [ascIndex('email'), ascIndex('name')],
          }),
        ],
        { fromDatabase: false },
      );
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ADDITIVE_ONLY_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts).toHaveLength(3);
    });

    it('rejects a validator add, which is widening, with additive-only policy', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = irWithCollection('users', []);
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ADDITIVE_ONLY_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.summary).toContain('widening');
    });

    it('allows widening validator removal with widening policy', () => {
      const wideningPolicy: MigrationOperationPolicy = {
        allowedOperationClasses: ['additive', 'widening'],
      };
      const contract = makeContract({ users: {} });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin, wideningPolicy);
      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.operationClass).toBe('widening');
    });
  });

  describe('index names', () => {
    const email = [{ field: 'email', direction: 1 as const }];
    const planIds = (contract: MongoContract, origin: MongoSchemaIR) =>
      planSuccess(planner, contract, origin).operations.map((op) => op.id);

    it('drops and creates an index whose content stays and whose name changes', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'User_email_key', keys: email, unique: true }] },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({ name: 'email_1', keys: email, unique: true }),
      ]);

      expect(planIds(contract, origin)).toEqual([
        'index.users.drop(email_1)',
        'index.users.create(User_email_key)',
      ]);
    });

    it('plans nothing for indexes whose names and content match', () => {
      const contract = makeContract({
        users: {
          indexes: [
            { name: 'User_email_key', keys: email, unique: true },
            { name: 'User_email_idx', keys: email },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({ name: 'User_email_idx', keys: email }),
        new MongoSchemaIndex({ name: 'User_email_key', keys: email, unique: true }),
      ]);

      expect(planIds(contract, origin)).toEqual([]);
    });

    it('drops and creates an index whose name stays and whose content changes', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: email, unique: true }] },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({ name: 'email_1', keys: email }),
      ]);

      expect(planIds(contract, origin)).toEqual([
        'index.users.drop(email_1)',
        'index.users.create(email_1)',
      ]);
    });

    it('creates each of two indexes on the same keys with different options under its own name', () => {
      const contract = makeContract({
        users: {
          indexes: [
            { name: 'User_email_key', keys: email, unique: true },
            { name: 'User_email_idx', keys: email },
            { name: 'User_email_sparse', keys: email, sparse: true },
          ],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());

      expect(
        plan.operations.map((op) => [
          op.id,
          (op as MongoMigrationPlanOperation).execute[0]?.command,
        ]),
      ).toEqual([
        [
          'index.users.create(User_email_key)',
          expect.objectContaining({ name: 'User_email_key', unique: true }),
        ],
        ['index.users.create(User_email_idx)', expect.objectContaining({ name: 'User_email_idx' })],
        [
          'index.users.create(User_email_sparse)',
          expect.objectContaining({ name: 'User_email_sparse', sparse: true }),
        ],
      ]);
    });

    it('drops an index by the name the origin holds it under, checking its options', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({ name: 'User_email_key', keys: email, unique: true }),
      ]);
      const plan = planSuccess(planner, contract, origin);

      const op = plan.operations[0] as MongoMigrationPlanOperation;
      expect({ command: op.execute[0]?.command, precheck: op.precheck[0]?.filter }).toEqual({
        command: expect.objectContaining({ kind: 'dropIndex', name: 'User_email_key' }),
        precheck: expect.objectContaining({
          exprs: [
            expect.objectContaining({ field: 'name', value: 'User_email_key' }),
            expect.objectContaining({
              exprs: expect.arrayContaining([
                expect.objectContaining({ field: 'unique', value: true }),
              ]),
            }),
          ],
        }),
      });
    });
  });

  describe('an origin read from a database', () => {
    const slug = [{ field: 'slug', direction: 1 as const }];
    const text = [
      { field: 'title', direction: 'text' as const },
      { field: 'body', direction: 'text' as const },
    ];
    const contract = makeContract({
      posts: {
        indexes: [
          { name: 'title_text_body_text', keys: text, weights: { title: 10 } },
          { name: 'slug_1', keys: slug, collation: { locale: 'en', strength: 2 } },
        ],
      },
    });
    const live = (fromDatabase: boolean) =>
      new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'posts',
            indexes: [
              new MongoSchemaIndex({
                name: 'title_text_body_text',
                keys: [
                  { field: '_fts', direction: 'text' },
                  { field: '_ftsx', direction: 1 },
                ],
                weights: { body: 1, title: 10 },
                default_language: 'english',
                language_override: 'language',
              }),
              new MongoSchemaIndex({
                name: 'slug_1',
                keys: slug,
                collation: { locale: 'en', strength: 2, caseLevel: false, numericOrdering: false },
              }),
            ],
          }),
        ],
        { fromDatabase },
      );

    it('pairs indexes as the verifier does, so server defaults plan nothing', () => {
      expect(planSuccess(planner, contract, live(true)).operations).toEqual([]);
    });

    it('creates each index as the contract writes it, not in the form it compares', () => {
      const empty = new MongoSchemaIR([], { fromDatabase: true });
      const created = planSuccess(planner, contract, empty).operations.flatMap((op) =>
        (op as MongoMigrationPlanOperation).execute.map((step) => step.command),
      );

      expect(created).toEqual([
        expect.objectContaining({
          kind: 'createIndex',
          name: 'title_text_body_text',
          keys: text,
          weights: { title: 10 },
        }),
        expect.objectContaining({
          kind: 'createIndex',
          name: 'slug_1',
          keys: slug,
          collation: { locale: 'en', strength: 2 },
        }),
      ]);
    });

    it('compares a contract origin exactly', () => {
      expect(planSuccess(planner, contract, live(false)).operations.map((op) => op.id)).toEqual([
        'index.posts.drop(title_text_body_text)',
        'index.posts.drop(slug_1)',
        'index.posts.create(title_text_body_text)',
        'index.posts.create(slug_1)',
      ]);
    });
  });

  describe('operation structure', () => {
    it('createIndex has correct precheck/execute/postcheck', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.precheck).toHaveLength(2);
      expect(op.precheck.map((check) => [check.source.kind, check.expect])).toEqual([
        ['listIndexes', 'notExists'],
        ['listIndexes', 'notExists'],
      ]);

      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('createIndex');

      expect(op.postcheck).toHaveLength(1);
      expect(op.postcheck[0]!.source.kind).toBe('listIndexes');
      expect(op.postcheck[0]!.expect).toBe('exists');
    });

    it('dropIndex has correct precheck/execute/postcheck', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.source.kind).toBe('listIndexes');
      expect(op.precheck[0]!.expect).toBe('exists');

      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('dropIndex');

      expect(op.postcheck).toHaveLength(1);
      expect(op.postcheck[0]!.source.kind).toBe('listIndexes');
      expect(op.postcheck[0]!.expect).toBe('notExists');
    });

    it('unique index postcheck includes unique filter', () => {
      const contract = makeContract({
        users: {
          indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true }],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.postcheck[0]!.filter.kind).toBe('and');
    });

    it('non-unique index postcheck requires the index not to be unique', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.postcheck[0]!.filter).toMatchObject({
        kind: 'and',
        exprs: expect.arrayContaining([
          expect.objectContaining({
            kind: 'and',
            exprs: expect.arrayContaining([
              { kind: 'not', expr: expect.objectContaining({ field: 'unique', value: true }) },
            ]),
          }),
        ]),
      });
    });

    it('createIndex sets a deterministic operation id', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations[0]!.id).toBe('index.users.create(email_1)');
    });

    it('dropIndex sets a deterministic operation id', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations[0]!.id).toBe('index.users.drop(email_1)');
    });
  });

  describe('M2 index vocabulary', () => {
    it('detects different wildcardProjection as distinct indexes', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              name: '$**_1',
              keys: [{ field: '$**', direction: 1 }],
              wildcardProjection: { name: 1, email: 1 },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          name: '$**_1',
          keys: [{ field: '$**', direction: 1 }],
          wildcardProjection: { name: 1 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('detects different collation as distinct indexes', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              name: 'name_1',
              keys: [{ field: 'name', direction: 1 }],
              collation: { locale: 'en', strength: 2 },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          name: 'name_1',
          keys: [{ field: 'name', direction: 1 }],
          collation: { locale: 'fr', strength: 2 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('treats same collation with different key order as identical', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              name: 'name_1',
              keys: [{ field: 'name', direction: 1 }],
              collation: { strength: 2, locale: 'en' },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          name: 'name_1',
          keys: [{ field: 'name', direction: 1 }],
          collation: { locale: 'en', strength: 2 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('detects different weights as distinct indexes', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              name: 'bio_text',
              keys: [{ field: 'bio', direction: 'text' }],
              weights: { bio: 10 },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          name: 'bio_text',
          keys: [{ field: 'bio', direction: 'text' }],
          weights: { bio: 5 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('passes M2 options through to CreateIndexCommand', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              name: 'bio_text',
              keys: [{ field: 'bio', direction: 'text' }],
              weights: { bio: 10 },
              default_language: 'english',
              language_override: 'lang',
              collation: { locale: 'en' },
              wildcardProjection: { bio: 1 },
            },
          ],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(1);
      const cmd = (plan.operations[0] as MongoMigrationPlanOperation).execute[0]!
        .command as CreateIndexCommand;
      expect(cmd.weights).toEqual({ bio: 10 });
      expect(cmd.default_language).toBe('english');
      expect(cmd.language_override).toBe('lang');
      expect(cmd.collation).toEqual({ locale: 'en' });
      expect(cmd.wildcardProjection).toEqual({ bio: 1 });
    });
  });

  describe('validator diffing', () => {
    it('emits collMod when validator is added', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = irWithCollection('users', []);
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      const cmd = collModOps[0]!.execute[0]!.command as CollModCommand;
      expect(cmd.validator).toEqual({ $jsonSchema: { bsonType: 'object' } });
      expect(cmd.validationLevel).toBe('strict');
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('validator add has precheck (collection exists) and postcheck (validator applied)', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = irWithCollection('users', []);
      const plan = planSuccess(planner, contract, origin);
      const op = (plan.operations as MongoMigrationPlanOperation[]).find(
        (o) => o.execute[0]?.command.kind === 'collMod',
      )!;

      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.source.kind).toBe('listCollections');
      expect(op.precheck[0]!.expect).toBe('exists');

      expect(op.postcheck).toHaveLength(1);
      expect(op.postcheck[0]!.source.kind).toBe('listCollections');
      expect(op.postcheck[0]!.expect).toBe('exists');
    });

    it('validator remove has precheck and empty postcheck', () => {
      const contract = makeContract({ users: {} });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const op = (plan.operations as MongoMigrationPlanOperation[]).find(
        (o) => o.execute[0]?.command.kind === 'collMod',
      )!;

      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.source.kind).toBe('listCollections');
      expect(op.precheck[0]!.expect).toBe('exists');

      expect(op.postcheck).toHaveLength(0);
    });

    it('classifies validator removal as widening', () => {
      const contract = makeContract({ users: {} });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    describe('a property whose schema admits more', () => {
      const JSON_TYPES = ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'];

      function validatorUpdate(originMeta: unknown, destMeta: unknown) {
        const jsonSchema = (meta: unknown) => ({
          bsonType: 'object',
          required: ['_id'],
          properties: { _id: { bsonType: 'objectId' }, name: { bsonType: 'string' }, meta },
          additionalProperties: false,
        });
        const contract = makeContract({
          items: {
            validator: {
              jsonSchema: jsonSchema(destMeta),
              validationLevel: 'strict',
              validationAction: 'error',
            },
          },
        });
        const origin = new MongoSchemaIR(
          [
            new MongoSchemaCollection({
              name: 'items',
              validator: new MongoSchemaValidator({
                jsonSchema: jsonSchema(originMeta),
                validationLevel: 'strict',
                validationAction: 'error',
              }),
            }),
          ],
          { fromDatabase: false },
        );
        const [operation] = planSuccess(planner, contract, origin).operations;
        return operation;
      }

      it('is widening when the schema becomes {}, as changing Json to Bson does', () => {
        expect(validatorUpdate({ bsonType: JSON_TYPES }, {})).toMatchObject({
          operationClass: 'widening',
          label: 'Update validator on items (changed: meta)',
        });
      });

      it('is widening when the bsonType list gains a type, as making a field optional does', () => {
        expect(validatorUpdate({ bsonType: 'int' }, { bsonType: ['null', 'int'] })).toMatchObject({
          operationClass: 'widening',
        });
      });

      it('is widening when the items of an array schema admit more', () => {
        expect(
          validatorUpdate(
            { bsonType: 'array', items: { bsonType: JSON_TYPES } },
            { bsonType: 'array', items: {} },
          ),
        ).toMatchObject({ operationClass: 'widening' });
      });

      it('is widening when the bsonType list loses a type, as changing Bson to Json does', () => {
        expect(validatorUpdate({}, { bsonType: JSON_TYPES })).toMatchObject({
          operationClass: 'widening',
          label: 'Update validator on items (changed: meta)',
        });
      });

      it('names added and removed properties in the label', () => {
        const contract = makeContract({
          items: {
            validator: {
              jsonSchema: {
                bsonType: 'object',
                properties: { name: { bsonType: 'string' }, note: { bsonType: 'string' } },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            },
          },
        });
        const origin = new MongoSchemaIR(
          [
            new MongoSchemaCollection({
              name: 'items',
              validator: new MongoSchemaValidator({
                jsonSchema: {
                  bsonType: 'object',
                  properties: { name: { bsonType: 'int' }, legacy: { bsonType: 'string' } },
                },
                validationLevel: 'strict',
                validationAction: 'error',
              }),
            }),
          ],
          { fromDatabase: false },
        );
        const labels = planSuccess(planner, contract, origin).operations.map(
          (operation) => operation.label,
        );
        expect(labels).toEqual([
          'Remove field legacy from collection items',
          'Update validator on items (changed: name; added: note; removed: legacy)',
        ]);
      });
    });

    it('classifies adding a non-required property as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: {
              bsonType: 'object',
              required: ['email'],
              properties: {
                email: { bsonType: 'string' },
                avatarUrl: { bsonType: ['null', 'string'] },
              },
            },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: {
                bsonType: 'object',
                required: ['email'],
                properties: { email: { bsonType: 'string' } },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies the open->closed transition (adding additionalProperties:false) as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: {
              bsonType: 'object',
              required: ['email'],
              properties: { email: { bsonType: 'string' } },
              additionalProperties: false,
            },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: {
                bsonType: 'object',
                required: ['email'],
                properties: { email: { bsonType: 'string' } },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies adding a non-required property to an already-closed schema as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: {
              bsonType: 'object',
              required: ['email'],
              properties: {
                email: { bsonType: 'string' },
                avatarUrl: { bsonType: ['null', 'string'] },
              },
              additionalProperties: false,
            },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: {
                bsonType: 'object',
                required: ['email'],
                properties: { email: { bsonType: 'string' } },
                additionalProperties: false,
              },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies narrowing an existing property type as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: {
              bsonType: 'object',
              properties: { age: { bsonType: 'int' } },
            },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: {
                bsonType: 'object',
                properties: { age: { bsonType: ['null', 'int'] } },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies adding a field to required as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: {
              bsonType: 'object',
              required: ['email', 'name'],
              properties: {
                email: { bsonType: 'string' },
                name: { bsonType: 'string' },
              },
            },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: {
                bsonType: 'object',
                required: ['email'],
                properties: {
                  email: { bsonType: 'string' },
                  name: { bsonType: 'string' },
                },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('treats reordered jsonSchema keys as equivalent (no operation emitted)', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { properties: { name: { bsonType: 'string' } }, bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(0);
    });

    it('classifies validationAction error->warn as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'warn',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies validationAction warn->error as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'warn',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies validationLevel strict->moderate as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'moderate',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies validationLevel moderate->strict as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'moderate',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies a validator that both relaxes and tightens as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'moderate',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'warn',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('no-ops when validators are identical', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });
  });

  describe('collection lifecycle', () => {
    it('emits createCollection for new collections with options', () => {
      const contract = makeContract({
        events: {
          options: { capped: { size: 1048576, max: 1000 } },
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const createOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'createCollection',
      );
      expect(createOps).toHaveLength(1);
      const cmd = createOps[0]!.execute[0]!.command as CreateCollectionCommand;
      expect(cmd.collection).toBe('events');
      expect(cmd.capped).toBe(true);
      expect(cmd.size).toBe(1048576);
    });

    // TML-2486: bare collections (no validator/options/indexes) must still
    // round-trip through `db init`. MongoDB creates collections implicitly
    // on first insert, but Prisma 8's schema verifier treats a contract-
    // declared collection that is absent from the live database as a
    // `missing_table` issue. The planner therefore has to emit an explicit
    // createCollection op so the runner provisions the collection before
    // verify runs.
    it('emits createCollection for new collections without options or indexes', () => {
      const contract = makeContract({
        users: {},
        posts: {},
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const createOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'createCollection',
      );
      const createdNames = createOps
        .map((op) => (op.execute[0]!.command as CreateCollectionCommand).collection)
        .sort();
      expect(createdNames).toEqual(['posts', 'users']);
      for (const op of createOps) {
        expect(op.operationClass).toBe('additive');
        const cmd = op.execute[0]!.command as CreateCollectionCommand;
        expect(cmd.capped).toBeUndefined();
        expect(cmd.validator).toBeUndefined();
      }
    });

    it('emits dropCollection for removed collections', () => {
      const contract = makeContract({});
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              capped: { size: 1048576 },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const dropOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'dropCollection',
      );
      expect(dropOps).toHaveLength(1);
      const cmd = dropOps[0]!.execute[0]!.command as DropCollectionCommand;
      expect(cmd.collection).toBe('events');
    });

    it('reports conflict for immutable option change (capped)', () => {
      const contract = makeContract({
        events: {
          options: { capped: { size: 2097152 } },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              capped: { size: 1048576 },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts.some((c) => c.summary.includes('immutable'))).toBe(true);
    });

    it('reports conflict when adding collation to existing collection without options', () => {
      const contract = makeContract({
        users: {
          options: { collation: { locale: 'en', strength: 2 } },
        },
      });
      const origin = new MongoSchemaIR([new MongoSchemaCollection({ name: 'users' })], {
        fromDatabase: false,
      });
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts.some((c) => c.summary.includes('immutable'))).toBe(true);
    });

    it('reports conflict when removing capped from existing collection', () => {
      const contract = makeContract({ events: {} });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              capped: { size: 1048576 },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts.some((c) => c.summary.includes('immutable'))).toBe(true);
    });

    it('reports conflict when clusteredIndex changes', () => {
      const contract = makeContract({
        events: {
          options: { clusteredIndex: { name: 'newName' } },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              clusteredIndex: {},
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts.some((c) => c.summary.includes('clusteredIndex'))).toBe(true);
    });

    function liveClusteredIndex(name: string) {
      const clusteredIndex = { v: 2, key: { _id: 1 }, unique: true, name };
      return clusteredIndex;
    }

    it('plans nothing for the clustered index fields the server fills in', () => {
      const contract = makeContract({ events: { options: { clusteredIndex: {} } } });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              clusteredIndex: liveClusteredIndex('_id_'),
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('success');
    });

    it('reports conflict when the contract removes a declared clustered index name', () => {
      const contract = makeContract({ events: { options: { clusteredIndex: {} } } });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              clusteredIndex: liveClusteredIndex('byId'),
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(
        result.kind === 'failure' ? result.conflicts.map(({ summary }) => summary) : [],
      ).toEqual([expect.stringContaining('clusteredIndex')]);
    });

    it('reports conflict when timeseries changes', () => {
      const contract = makeContract({
        events: {
          options: {
            timeseries: { timeField: 'ts', metaField: 'newMeta', granularity: 'seconds' },
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts.some((c) => c.summary.includes('timeseries'))).toBe(true);
    });

    it('reports policy violations with createCollection and createIndex labels', () => {
      const contract = makeContract({
        newColl: {
          options: { capped: { size: 1024 } },
          indexes: [{ name: 'ts_1', keys: [{ field: 'ts', direction: 1 }] }],
        },
      });
      const result = planner.plan({
        contract,
        schema: emptyIR(),
        policy: { allowedOperationClasses: [] },
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts.some((c) => c.summary.includes('Create collection newColl'))).toBe(
        true,
      );
      expect(result.conflicts.some((c) => c.summary.includes('Create index ts_1 on newColl'))).toBe(
        true,
      );
    });

    it('treats reordered collation keys as equivalent (no conflict)', () => {
      const contract = makeContract({
        users: {
          options: { collation: { strength: 2, locale: 'en' } },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            options: new MongoSchemaCollectionOptions({
              collation: { locale: 'en', strength: 2 },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('classifies enabling changeStreamPreAndPostImages as widening', () => {
      const contract = makeContract({
        events: {
          options: { changeStreamPreAndPostImages: { enabled: true } },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              changeStreamPreAndPostImages: { enabled: false },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies disabling changeStreamPreAndPostImages as widening', () => {
      const contract = makeContract({
        events: {
          options: { changeStreamPreAndPostImages: { enabled: false } },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              changeStreamPreAndPostImages: { enabled: true },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('emits { enabled: false } when destination removes changeStreamPreAndPostImages', () => {
      const contract = makeContract({ events: {} });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              changeStreamPreAndPostImages: { enabled: true },
            }),
          }),
        ],
        { fromDatabase: false },
      );
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
      const cmd = collModOps[0]!.execute[0]!.command as CollModCommand;
      expect(cmd.changeStreamPreAndPostImages).toEqual({ enabled: false });
    });

    it('orders creates before indexes, drops after', () => {
      const contract = makeContract({
        events: {
          indexes: [{ name: 'ts_1', keys: [{ field: 'ts', direction: 1 as const }] }],
          options: { capped: { size: 1048576 } },
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const kinds = (plan.operations as MongoMigrationPlanOperation[]).map(
        (op) => op.execute[0]!.command.kind,
      );
      const createCollIdx = kinds.indexOf('createCollection');
      const createIdxIdx = kinds.indexOf('createIndex');
      expect(createCollIdx).toBeLessThan(createIdxIdx);
    });
  });

  describe('plan metadata', () => {
    it('sets destination storageHash from contract', () => {
      const contract = makeContract({ users: {} });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.destination.storageHash).toBe('test-storage');
    });

    it('does not include profileHash in destination (migrations use storageHash only)', () => {
      const contract = makeContract({ users: {} });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.destination).not.toHaveProperty('profileHash');
    });
  });

  describe('planCalls', () => {
    function planCallsSuccess(
      p: MongoMigrationPlanner,
      contract: MongoContract,
      schema: MongoSchemaIR,
      policy = ALL_CLASSES_POLICY,
    ) {
      const result = p.planCalls({
        contract,
        schema,
        policy,
        fromContract: null,
        frameworkComponents: [],
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error('Expected success');
      return result.calls;
    }

    it('returns OpFactoryCall[] for index creation', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const calls = planCallsSuccess(planner, contract, emptyIR());

      expect(calls).toHaveLength(1);
      expect(calls[0]).toBeInstanceOf(CreateIndexCall);
      expect(calls[0]).toMatchObject({
        collection: 'users',
        keys: [{ field: 'email', direction: 1 }],
      });
    });

    it('returns OpFactoryCall[] for index drop', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const calls = planCallsSuccess(planner, contract, origin);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.factoryName).toBe('dropIndex');
    });

    it('returns failure with conflicts for immutable option changes', () => {
      const contract = makeContract({
        users: { options: { capped: { size: 2048 } } },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            indexes: [],
            options: new MongoSchemaCollectionOptions({ capped: { size: 1024 } }),
          }),
        ],
        { fromDatabase: false },
      );

      const result = planner.planCalls({
        fromContract: null,
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts[0]!.summary).toContain('capped');
    });

    it('returns failure when policy rejects operation class', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });

      const result = planner.planCalls({
        fromContract: null,
        contract,
        schema: emptyIR(),
        policy: { allowedOperationClasses: ['destructive'] },
        frameworkComponents: [],
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts[0]!.summary).toContain('additive');
    });

    it('produces collMod calls with meta for validator diff', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { required: ['email', 'name'] },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            indexes: [],
            validator: new MongoSchemaValidator({
              jsonSchema: { required: ['email'] },
              validationLevel: 'moderate',
              validationAction: 'warn',
            }),
          }),
        ],
        { fromDatabase: false },
      );

      const calls = planCallsSuccess(planner, contract, origin);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toBeInstanceOf(CollModCall);
      expect((calls[0] as CollModCall).meta).toMatchObject({
        id: 'validator.users.update',
        label: 'Update validator on users',
        operationClass: 'widening',
      });
    });

    it('produces collMod call with widening operationClass for relaxation', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { required: ['email'] },
            validationLevel: 'moderate',
            validationAction: 'warn',
          },
        },
      });
      const origin = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            indexes: [],
            validator: new MongoSchemaValidator({
              jsonSchema: { required: ['email'] },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        ],
        { fromDatabase: false },
      );

      const calls = planCallsSuccess(planner, contract, origin);

      expect(calls).toHaveLength(1);
      const call = calls[0] as CollModCall;
      expect(call.meta?.operationClass).toBe('widening');
    });

    it('produces collMod call for mutable options diff', () => {
      const contract = makeContract({
        events: {
          options: { changeStreamPreAndPostImages: { enabled: true } },
        },
      });
      const origin = new MongoSchemaIR(
        [new MongoSchemaCollection({ name: 'events', indexes: [] })],
        { fromDatabase: false },
      );

      const calls = planCallsSuccess(planner, contract, origin);

      const collModCalls = calls.filter((c): c is CollModCall => c instanceof CollModCall);
      expect(collModCalls).toHaveLength(1);
      expect(collModCalls[0]!.meta?.id).toBe('options.events.update');
    });

    it('returns empty calls when schemas are identical', () => {
      const contract = makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const calls = planCallsSuccess(planner, contract, origin);

      expect(calls).toHaveLength(0);
    });
  });

  describe('polymorphic collections', () => {
    it('does not createCollection for variant names when contract has only the base collection', () => {
      const contract = makeContract({
        tasks: {
          indexes: [{ name: 'title_1', keys: [{ field: 'title', direction: 1 }] }],
          validator: {
            jsonSchema: {
              bsonType: 'object',
              required: ['_id', 'title', 'type'],
              properties: {
                _id: { bsonType: 'objectId' },
                title: { bsonType: 'string' },
                type: { bsonType: 'string' },
              },
              oneOf: [
                {
                  properties: {
                    type: { enum: ['bug'] },
                    severity: { bsonType: 'string' },
                  },
                  required: ['severity'],
                },
                {
                  properties: {
                    type: { enum: ['feature'] },
                    priority: { bsonType: 'int' },
                  },
                  required: ['priority'],
                },
              ],
            },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });

      const plan = planSuccess(planner, contract, emptyIR());
      const collectionNames = (plan.operations as MongoMigrationPlanOperation[])
        .filter((op) => op.execute[0]?.command.kind === 'createCollection')
        .map((op) => (op.execute[0]!.command as CreateCollectionCommand).collection);

      expect(collectionNames).toEqual(['tasks']);
      expect(collectionNames).not.toContain('bug');
      expect(collectionNames).not.toContain('feature');
    });
  });

  describe('plan().plan.origin', () => {
    it('reflects fromContract.storage.storageHash when fromContract is supplied', () => {
      // Distinct storage hashes so the assertion fails if `origin` is
      // accidentally derived from `destination` instead of `fromContract`.
      const contract = makeContract({}, 'destination-only');
      const fromContract = makeContract({}, 'from-only');
      const result = planner.plan({
        contract,
        schema: emptyIR(),
        policy: ALL_CLASSES_POLICY,
        fromContract,
        origin: planOriginOf(fromContract),
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error('Expected success');
      expect(result.plan.origin).toEqual({ storageHash: 'from-only' });
    });

    it('is null when fromContract is null', () => {
      const contract = makeContract({});
      const result = planner.plan({
        contract,
        schema: emptyIR(),
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error('Expected success');
      expect(result.plan.origin).toBeNull();
    });
  });

  describe('emptyMigration', () => {
    it("identifies as the 'mongo' target with no operations and the supplied destination hash", () => {
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: '00',
        toHash: '01',
        snapshotsImportPath: '../../snapshots',
      });

      expect(empty.targetId).toBe('mongo');
      expect(empty.operations).toEqual([]);
      expect(empty.destination).toEqual({ storageHash: '01' });
    });

    it('renders a migration.ts stub that imports Migration and calls MigrationCLI.run', () => {
      const fromHash = '0'.repeat(64);
      const toHash = '1'.repeat(64);
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash,
        toHash,
        snapshotsImportPath: '../../snapshots',
      });

      const source = empty.renderTypeScript(keepInternalSpecifiers);

      expect(source).toContain(
        "import { Migration, MigrationCLI } from '@internal/target-mongo/migration';",
      );
      expect(source).toContain('class M extends Migration<Start, End>');
      expect(source).toContain('MigrationCLI.run(import.meta.url, M);');
      // New shape: from/to are derived from the imported contract JSON, not
      // embedded as literals or a describe() block.
      expect(source).toContain('override readonly endContractJson = endContract;');
      expect(source).not.toContain('describe()');
      expect(source).not.toContain(`"${fromHash}"`);
      expect(source).not.toContain(`"${toHash}"`);
    });

    it('produces a plan whose origin reflects the supplied fromHash', () => {
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: '00',
        toHash: '01',
        snapshotsImportPath: '../../snapshots',
      });

      expect(empty.origin).toEqual({ storageHash: '00' });
    });

    it('treats a null fromHash as a null origin', () => {
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: null,
        toHash: '01',
        snapshotsImportPath: '../../snapshots',
      });

      expect(empty.origin).toBeNull();
    });
  });

  describe('value set is non-physical', () => {
    // Build the value-set-carrying storage through the real mongo-contract IR factories
    // (`buildMongoNamespace` hydrates `entries.valueSet` into `MongoValueSet` nodes; `MongoStorage`
    // wraps it) rather than patching a raw contract object — the namespace factory is the same
    // construction path authoring uses.
    function makeContractWithValueSet(
      collections: Record<string, MongoCollectionData>,
      valueSets: Record<
        string,
        { readonly kind: 'valueSet'; readonly values: readonly JsonValue[] }
      >,
    ): MongoContract {
      const base = makeContract(collections);
      const builtCollections: Record<string, MongoCollection> = {};
      for (const [name, data] of Object.entries(collections)) {
        builtCollections[name] = makeStorageCollection(data);
      }
      const namespace = buildMongoNamespace({
        id: '__unbound__',
        entries: { collection: builtCollections, valueSet: valueSets },
      });
      const storage = new MongoStorage({
        storageHash: coreHash('test-storage'),
        namespaces: { __unbound__: namespace },
      });
      return { ...base, storage };
    }

    it('emits no migration op when the only storage delta is a value-set addition', () => {
      // Origin schema matches the collection exactly; the contract adds a value
      // set. The planner reads only entries.collection, so the value set produces
      // no op — the validator (physical artifact) is unchanged.
      const contract = makeContractWithValueSet(
        { users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] } },
        { Role: { kind: 'valueSet', values: ['admin', 'author', 'reader'] } },
      );
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });
  });
});
