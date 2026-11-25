import { MongoExistsExpr } from '@internal/mongo-query-ast/control';
import { ObjectId } from 'bson';
import { MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  collMod,
  dataTransform,
  rawAggregate,
  renameCollection,
  setValidation,
} from '../src/core/migrations/migration-factories';
import { execute, failureFields, makeHarness } from './mongo-runner-harness';

describe('MongoMigrationRunner, a copy in a data transform that the target collection rejects', () => {
  const rejected = () =>
    new MongoServerError({
      ok: 0,
      code: 121,
      codeName: 'DocumentValidationFailure',
      errmsg: 'PlanExecutor error during aggregation :: caused by :: Document failed validation',
    });

  it('calls it a copy into that collection, and with no later validator update names the pipeline to fix', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
    ]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message:
        'Operation data_transform.move User to members failed: the validator of collection members rejected a document the copy wrote',
      why: "MongoDB error 121 (DocumentValidationFailure): Document failed validation. Documents the copy wrote before the error stay in collection members, and the copy runs again on a re-run. No later operation of this migration updates the validator of collection members, so change the pipeline in the migration's migration.ts so the documents it writes fit the validator, run the file with node, then run the command again. The operations that ran before the failure stay applied.",
      meta: {
        operationId: 'data_transform.move User to members',
        mongoCode: 121,
        codeName: 'DocumentValidationFailure',
        collection: 'members',
      },
    });
  });

  it('names the option that skips validation when a later operation of the migration updates the validator', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
      setValidation('members', { bsonType: 'object' }, { checkDocuments: true }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toBe(
      "MongoDB error 121 (DocumentValidationFailure): Document failed validation. Documents the copy wrote before the error stay in collection members, and the copy runs again on a re-run. A later operation of this migration updates the validator of collection members: add { bypassDocumentValidation: true } as the last argument of the copy's rawAggregate call, so that update checks the moved documents. Run the file with node, then run the command again. The operations that ran before the failure stay applied.",
    );
  });

  it('says the copy must fit the validator when the later validator update does not check the documents', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
      setValidation('members', { bsonType: 'object' }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toBe(
      "MongoDB error 121 (DocumentValidationFailure): Document failed validation. Documents the copy wrote before the error stay in collection members, and the copy runs again on a re-run. A later operation of this migration updates the validator of collection members without checking the documents already in it, so change the pipeline in the migration's migration.ts so the documents it writes fit the validator, run the file with node, then run the command again. The operations that ran before the failure stay applied.",
    );
  });

  it('does not take a later precheck that only reads the target for the check of its documents against the new validator', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());
    const update = setValidation('members', { bsonType: 'object' });

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
      {
        ...update,
        precheck: [
          {
            description: 'members holds a document',
            source: rawAggregate('members', [{ $limit: 1 }]),
            filter: MongoExistsExpr.exists('_id'),
            expect: 'exists',
          },
        ],
      },
    ]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'A later operation of this migration updates the validator of collection members without checking the documents already in it',
    );
  });

  it('says what a later validator removal does, which checks nothing', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
      collMod('members', { validator: {}, validationLevel: 'strict', validationAction: 'error' }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      "A later operation of this migration removes the validator of collection members: add { bypassDocumentValidation: true } as the last argument of the copy's rawAggregate call, so the copy does not have to fit the validator that is then removed.",
    );
  });

  it('finds a later validator update on the target under the name a later rename gives it', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
      renameCollection('members', 'people'),
      setValidation('people', { bsonType: 'object' }, { checkDocuments: true }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'A later operation of this migration updates the validator of collection members, as collection people:',
    );
  });

  it('names the document the validator rejected, and where to find it, when MongoDB names it', async () => {
    const harness = makeHarness();
    const id = new ObjectId('6650a1b2c3d4e5f6a7b8c9d0');
    harness.driver.failAggregateWith(
      new MongoServerError({
        ok: 0,
        code: 121,
        codeName: 'DocumentValidationFailure',
        errmsg: 'PlanExecutor error during aggregation :: caused by :: Document failed validation',
        errInfo: { failingDocumentId: id, details: {} },
      }),
    );

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'Document failed validation. The rejected document has _id ObjectId("6650a1b2c3d4e5f6a7b8c9d0"): find it with db.getCollection("users").find({ _id: ObjectId("6650a1b2c3d4e5f6a7b8c9d0") }) in mongosh. Documents the copy wrote before the error stay in collection members, and the copy runs again on a re-run. No later operation of this migration updates the validator of collection members, so fix that document in its source and run the command again, or change the pipeline in the migration\'s migration.ts so the documents it writes fit the validator, run the file with node, then run the command again.',
    );
  });

  it('names the database of a copy into another database, and gives both routes, since the migration updates validators of its own database only', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [
            { $match: { kind: 'user' } },
            { $merge: { into: { db: 'archive', coll: 'members' } } },
          ]),
      }),
    ]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      message:
        'Operation data_transform.move User to members failed: the validator of collection archive.members rejected a document the copy wrote',
      why: expect.stringContaining(
        "If a later validator update checks the documents of collection archive.members against a new validator, add { bypassDocumentValidation: true } as the last argument of the copy's rawAggregate call, so that update checks the moved documents, and run the file with node, then run the command again. Otherwise change the pipeline",
      ),
    });
  });

  it('says an $out stage leaves its collection as it was, since it replaces the collection only when it succeeds', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(rejected());

    const result = await execute(harness, [
      dataTransform('rebuild members', {
        run: () => rawAggregate('users', [{ $match: { kind: 'user' } }, { $out: 'members' }]),
      }),
    ]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      message:
        'Operation data_transform.rebuild members failed: the validator of collection members rejected a document the $out stage wrote',
      why: expect.stringContaining(
        'Collection members is as it was: an $out stage replaces it only when the whole pipeline succeeds.',
      ),
    });
  });

  it('gives a copy that fails for another reason the advice for any data transform', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(
      new MongoServerError({
        ok: 0,
        code: 11000,
        codeName: 'DuplicateKey',
        errmsg: 'E11000 duplicate key error',
      }),
    );

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
      }),
    ]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      message:
        'Operation data_transform.move User to members failed: MongoDB error 11000 (DuplicateKey): E11000 duplicate key error',
      why: expect.not.stringContaining('bypassDocumentValidation'),
    });
  });
});
