import { asNamespaceId } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';

const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const NAMESPACE = asNamespaceId('__unbound__');

function contractWithModel(model: string, collection: string): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          models: { [model]: { fields: {}, relations: {}, storage: { collection } } },
        },
      },
    },
    storage: {
      storageHash: `storage-${collection}`,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: { [collection]: new MongoCollection({}) } },
        },
      },
    },
  } as unknown as MongoContract;
}

const modelRename: ResolvedMigrationStatement = {
  kind: 'rename',
  entity: 'model',
  from: { namespaceId: NAMESPACE, model: 'Profile' },
  to: { namespaceId: NAMESPACE, model: 'User' },
};

const fieldRename: ResolvedMigrationStatement = {
  kind: 'rename',
  entity: 'field',
  from: { namespaceId: NAMESPACE, model: 'Profile', field: 'name' },
  to: { namespaceId: NAMESPACE, model: 'User', field: 'fullName' },
};

function plan(
  statements: readonly ResolvedMigrationStatement[],
  collections: { readonly from: string; readonly to: string } = { from: 'profiles', to: 'users' },
) {
  return new MongoMigrationPlanner().plan({
    contract: contractWithModel('User', collections.to),
    schema: new MongoSchemaIR([new MongoSchemaCollection({ name: collections.from })]),
    policy: ALL_CLASSES_POLICY,
    fromContract: contractWithModel('Profile', collections.from),
    origin: null,
    statements,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
}

describe('MongoMigrationPlanner with statements', () => {
  it('plans the rename as a collection drop and create when no statement is given', async () => {
    const result = plan([]);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');
    const operations = await Promise.all(result.plan.operations);
    expect(operations.map((operation) => operation.id)).toEqual([
      'collection.users.create',
      'collection.profiles.drop',
    ]);
    expect(result.appliedStatements).toEqual([]);
  });

  it('refuses the first statement, plans nothing, and says how to keep the documents', () => {
    expect(plan([modelRename, fieldRename])).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'MongoDB does not apply rename statements in this release, so nothing was planned: rename model "Profile" to "User"',
          why: 'MongoDB cannot carry out rename statements in this release. Without the statement, a plan drops collection "profiles" with its documents and creates collection "users". To keep the documents, rename the collection by hand on each database before a plan made without the statement is applied there, for example with db.getCollection("profiles").renameCollection("users") in mongosh. A migration written by migration plan without the statement still drops "profiles" wherever it is applied, so check its operations first.',
          refusedStatement: modelRename,
        },
      ],
    });
  });

  it('names a field through the model the destination contract names, and says how to move its values', () => {
    const result = plan([fieldRename]);
    if (result.kind !== 'failure') throw new Error('Expected failure');
    expect(result.conflicts).toMatchObject([
      {
        kind: 'statementRefused',
        summary: expect.stringContaining('rename field "User.name" to "User.fullName"'),
        why: 'MongoDB cannot carry out rename statements in this release. Without the statement, the documents in collection "profiles" keep their values under "name", and nothing moves them to "fullName". To move them, run these in mongosh on each database before a plan made without the statement is applied there, using the field names as they are stored. First turn off the collection\'s validator, which still requires "name": db.runCommand({ collMod: "profiles", validationLevel: "off" }). Then drop each unique index that includes "name", or the move fails once two documents have lost it, for example db.getCollection("profiles").dropIndex("name_1"). Then move the values: db.getCollection("profiles").updateMany({}, { $rename: { "name": "fullName" } }). Applying the plan then creates the indexes on "fullName" and turns the validator back on.',
        refusedStatement: fieldRename,
      },
    ]);
  });

  it('says a plan without the statement keeps the documents when both models use one collection', () => {
    const result = plan([modelRename], { from: 'posts', to: 'posts' });
    if (result.kind !== 'failure') throw new Error('Expected failure');
    expect(result.conflicts).toMatchObject([
      {
        kind: 'statementRefused',
        why: 'MongoDB cannot carry out rename statements in this release. Both models store their documents in collection "posts", so a plan made without the statement keeps them.',
        refusedStatement: modelRename,
      },
    ]);
  });
});
