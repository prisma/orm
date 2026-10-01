import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import {
  MongoCollection,
  type MongoCollectionOptions,
  type MongoCollectionOptionsInput,
  type MongoContract,
  type MongoIndex,
  type MongoIndexInput,
  type MongoValidator,
  type MongoValidatorInput,
} from '@internal/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import {
  collMod,
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
} from '../src/core/migrations/migration-factories';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
} from '../src/core/migrations/op-factory-call';
import { renderOps } from '../src/core/migrations/render-ops';

const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

type MongoCollectionData = {
  readonly indexes?: readonly (MongoIndex | MongoIndexInput)[];
  readonly validator?: MongoValidator | MongoValidatorInput;
  readonly options?: MongoCollectionOptions | MongoCollectionOptionsInput;
};

function makeStorageCollection(data: MongoCollectionData): MongoCollection {
  return new MongoCollection(data);
}

function makeContract(collections: Record<string, MongoCollectionData>): MongoContract {
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
      storageHash: 'test-storage',
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
  return new MongoSchemaIR([]);
}

describe('renderOps', () => {
  describe('individual call rendering', () => {
    it('renders createIndex call', () => {
      const keys = [{ field: 'email', direction: 1 as const }];
      const call = new CreateIndexCall('users', keys, { unique: true });

      const ops = renderOps([call]);

      expect(ops).toHaveLength(1);
      expect(ops[0]).toEqual(createIndex('users', keys, { unique: true }));
    });

    it('renders dropIndex call', () => {
      const keys = [{ field: 'email', direction: 1 as const }];
      const call = new DropIndexCall('users', keys);

      const ops = renderOps([call]);

      expect(ops).toHaveLength(1);
      expect(ops[0]).toEqual(dropIndex('users', keys));
    });

    it('renders createCollection call', () => {
      const call = new CreateCollectionCall('users', {
        validator: { $jsonSchema: { required: ['email'] } },
        validationLevel: 'strict',
      });

      const ops = renderOps([call]);

      expect(ops).toHaveLength(1);
      expect(ops[0]).toEqual(
        createCollection('users', {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
        }),
      );
    });

    it('renders dropCollection call', () => {
      const call = new DropCollectionCall('users');

      const ops = renderOps([call]);

      expect(ops).toHaveLength(1);
      expect(ops[0]).toEqual(dropCollection('users'));
    });

    it('renders collMod call with meta', () => {
      const call = new CollModCall(
        'users',
        {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.users.add',
          label: 'Add validator on users',
          operationClass: 'destructive',
        },
      );

      const ops = renderOps([call]);

      expect(ops).toHaveLength(1);
      expect(ops[0]).toEqual(
        collMod(
          'users',
          {
            validator: { $jsonSchema: { required: ['email'] } },
            validationLevel: 'strict',
            validationAction: 'error',
          },
          {
            id: 'validator.users.add',
            label: 'Add validator on users',
            operationClass: 'destructive',
          },
        ),
      );
    });
  });

  describe('round-trip equivalence with planner', () => {
    const planner = new MongoMigrationPlanner();

    it('produces identical JSON for index creation scenario', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const schema = emptyIR();

      const planResult = planner.plan({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      const callsResult = planner.planCalls({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });

      expect(planResult.kind).toBe('success');
      expect(callsResult.kind).toBe('success');
      if (planResult.kind !== 'success' || callsResult.kind !== 'success')
        throw new Error('Expected success');

      const rendered = renderOps(callsResult.calls);
      expect(JSON.stringify(rendered)).toBe(JSON.stringify(planResult.plan.operations));
    });

    it('produces identical JSON for index drop scenario', () => {
      const contract = makeContract({ users: {} });
      const schema = new MongoSchemaIR([
        new MongoSchemaCollection({
          name: 'users',
          indexes: [new MongoSchemaIndex({ keys: [{ field: 'email', direction: 1 }] })],
        }),
      ]);

      const planResult = planner.plan({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      const callsResult = planner.planCalls({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });

      expect(planResult.kind).toBe('success');
      expect(callsResult.kind).toBe('success');
      if (planResult.kind !== 'success' || callsResult.kind !== 'success')
        throw new Error('Expected success');

      const rendered = renderOps(callsResult.calls);
      expect(JSON.stringify(rendered)).toBe(JSON.stringify(planResult.plan.operations));
    });

    it('produces identical JSON for collection create with validator', () => {
      const contract = makeContract({
        users: {
          indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }],
          validator: {
            jsonSchema: { required: ['email'] },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const schema = emptyIR();

      const planResult = planner.plan({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      const callsResult = planner.planCalls({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });

      expect(planResult.kind).toBe('success');
      expect(callsResult.kind).toBe('success');
      if (planResult.kind !== 'success' || callsResult.kind !== 'success')
        throw new Error('Expected success');

      const rendered = renderOps(callsResult.calls);
      expect(JSON.stringify(rendered)).toBe(JSON.stringify(planResult.plan.operations));
    });

    it('produces identical JSON for collection drop scenario', () => {
      const contract = makeContract({});
      const schema = new MongoSchemaIR([
        new MongoSchemaCollection({
          name: 'users',
          indexes: [new MongoSchemaIndex({ keys: [{ field: 'email', direction: 1 }] })],
        }),
      ]);

      const planResult = planner.plan({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      const callsResult = planner.planCalls({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });

      expect(planResult.kind).toBe('success');
      expect(callsResult.kind).toBe('success');
      if (planResult.kind !== 'success' || callsResult.kind !== 'success')
        throw new Error('Expected success');

      const rendered = renderOps(callsResult.calls);
      expect(JSON.stringify(rendered)).toBe(JSON.stringify(planResult.plan.operations));
    });

    it('produces identical JSON for validator update scenario', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { required: ['email', 'name'] },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const schema = new MongoSchemaIR([
        new MongoSchemaCollection({
          name: 'users',
          indexes: [],
          validator: new MongoSchemaValidator({
            jsonSchema: { required: ['email'] },
            validationLevel: 'moderate',
            validationAction: 'warn',
          }),
        }),
      ]);

      const planResult = planner.plan({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      const callsResult = planner.planCalls({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });

      expect(planResult.kind).toBe('success');
      expect(callsResult.kind).toBe('success');
      if (planResult.kind !== 'success' || callsResult.kind !== 'success')
        throw new Error('Expected success');

      const rendered = renderOps(callsResult.calls);
      expect(JSON.stringify(rendered)).toBe(JSON.stringify(planResult.plan.operations));
    });

    it('produces identical JSON for complex multi-collection scenario', () => {
      const contract = makeContract({
        orders: {
          indexes: [
            { keys: [{ field: 'customerId', direction: 1 }] },
            { keys: [{ field: 'createdAt', direction: -1 }] },
          ],
          options: { changeStreamPreAndPostImages: { enabled: true } },
        },
        products: {
          indexes: [{ keys: [{ field: 'sku', direction: 1 }], unique: true }],
          validator: {
            jsonSchema: { required: ['name', 'price'] },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const schema = new MongoSchemaIR([
        new MongoSchemaCollection({
          name: 'orders',
          indexes: [
            new MongoSchemaIndex({ keys: [{ field: 'customerId', direction: 1 }] }),
            new MongoSchemaIndex({ keys: [{ field: 'status', direction: 1 }] }),
          ],
        }),
        new MongoSchemaCollection({
          name: 'legacy',
          indexes: [],
        }),
      ]);

      const planResult = planner.plan({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      const callsResult = planner.planCalls({
        contract,
        schema,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });

      expect(planResult.kind).toBe('success');
      expect(callsResult.kind).toBe('success');
      if (planResult.kind !== 'success' || callsResult.kind !== 'success')
        throw new Error('Expected success');

      const rendered = renderOps(callsResult.calls);
      expect(JSON.stringify(rendered)).toBe(JSON.stringify(planResult.plan.operations));
    });
  });
});
