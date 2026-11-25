import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { ObjectId } from 'bson';
import { MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  collMod,
  dataTransform,
  deleteDocuments,
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

  describe('when a later validator update does not check the documents, says to make it check them and the copy skip validation, or make the copy fit', () => {
    const copy = dataTransform('move User to members', {
      run: () =>
        rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
    });
    const advice = (collection: string) =>
      `MongoDB error 121 (DocumentValidationFailure): Document failed validation. Documents the copy wrote before the error stay in collection members, and the copy runs again on a re-run. A later operation of this migration updates the validator of collection ${collection} without checking the documents already in it. In the migration's migration.ts, set checkDocuments to true on that update and add { bypassDocumentValidation: true } as the last argument of the copy's rawAggregate call, so the copy writes under the old validator and that update checks every document, the moved ones too: run the file with node, then run the command again. Or change the pipeline in the migration's migration.ts so the documents it writes fit the validator, run the file with node, then run the command again. The operations that ran before the failure stay applied.`;

    it.each([
      [
        'the update follows the copy',
        [setValidation('members', { bsonType: 'object' })],
        'members',
      ],
      [
        'the delete of the moved documents comes between them, as the routes write a move',
        [
          deleteDocuments({ collection: 'users', filter: { kind: 'user' } }),
          setValidation('members', { bsonType: 'object' }),
        ],
        'members',
      ],
      [
        'the target is renamed between them',
        [renameCollection('members', 'people'), setValidation('people', { bsonType: 'object' })],
        'members, as collection people,',
      ],
    ])('%s', async (_name, later, collection) => {
      const harness = makeHarness();
      harness.driver.failAggregateWith(rejected());

      const result = await execute(harness, [copy, ...later]);

      expect(failureFields(result.assertNotOk()).why).toBe(advice(collection));
    });
  });

  describe('does not take a later precheck for the check of the documents against the new validator when it differs from that check', () => {
    const validator = { $jsonSchema: { bsonType: 'object' } };
    const checked = setValidation('members', validator.$jsonSchema, { checkDocuments: true });
    const collectionExists = checked.precheck.slice(0, -1);
    const documentsFit = checked.precheck.at(-1);
    if (documentsFit === undefined) {
      throw new Error('setValidation with checkDocuments has no document check');
    }
    const withPipeline = (pipeline: ReadonlyArray<Record<string, unknown>>) => ({
      ...documentsFit,
      source: rawAggregate('members', pipeline),
    });
    const rejectedByValidator = { $match: { $nor: [validator] } };

    it.each([
      [
        'matches another filter',
        withPipeline([{ $match: { email: { $exists: true } } }, { $limit: 1 }]),
      ],
      ['expects a document to exist', { ...documentsFit, expect: 'exists' as const }],
      [
        'keeps only the documents a narrower filter selects',
        { ...documentsFit, filter: MongoFieldFilter.eq('_id', 'sentinel') },
      ],
      [
        'has a stage other than $limit after the $match',
        withPipeline([rejectedByValidator, { $project: { _id: 1 } }]),
      ],
    ])('a precheck that %s', async (_name, precheck) => {
      const harness = makeHarness();
      harness.driver.failAggregateWith(rejected());

      const result = await execute(harness, [
        dataTransform('move User to members', {
          run: () =>
            rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }]),
        }),
        { ...checked, precheck: [...collectionExists, precheck] },
      ]);

      expect(failureFields(result.assertNotOk()).why).toContain(
        'A later operation of this migration updates the validator of collection members without checking the documents already in it',
      );
    });
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

  describe('names the rejected document without a lookup in the source when the pipeline may change its _id', () => {
    const id = new ObjectId('6650a1b2c3d4e5f6a7b8c9d0');
    const failWithId = (harness: ReturnType<typeof makeHarness>) =>
      harness.driver.failAggregateWith(
        new MongoServerError({
          ok: 0,
          code: 121,
          codeName: 'DocumentValidationFailure',
          errmsg:
            'PlanExecutor error during aggregation :: caused by :: Document failed validation',
          errInfo: { failingDocumentId: id, details: {} },
        }),
      );

    it.each([
      ['sets _id', { $set: { _id: '$legacyId' } }],
      ['groups the documents', { $group: { _id: '$kind' } }],
      ['drops _id', { $project: { _id: 0, email: 1 } }],
    ])('a pipeline that %s', async (_name, stage) => {
      const harness = makeHarness();
      failWithId(harness);

      const result = await execute(harness, [
        dataTransform('move User to members', {
          run: () =>
            rawAggregate('users', [
              { $match: { kind: 'user' } },
              stage,
              { $merge: { into: 'members' } },
            ]),
        }),
      ]);

      expect(failureFields(result.assertNotOk()).why).toContain(
        'Document failed validation. The copy wrote the rejected document with _id ObjectId("6650a1b2c3d4e5f6a7b8c9d0"). Documents the copy wrote before the error stay in collection members, and the copy runs again on a re-run. No later operation of this migration updates the validator of collection members, so change the pipeline',
      );
    });

    it('keeps the lookup when the stages before the copy keep _id', async () => {
      const harness = makeHarness();
      failWithId(harness);

      const result = await execute(harness, [
        dataTransform('move User to members', {
          run: () =>
            rawAggregate('users', [
              { $match: { kind: 'user' } },
              { $set: { email_address: '$email' } },
              { $unset: ['email'] },
              { $merge: { into: 'members' } },
            ]),
        }),
      ]);

      expect(failureFields(result.assertNotOk()).why).toContain(
        'find it with db.getCollection("users").find({ _id: ObjectId("6650a1b2c3d4e5f6a7b8c9d0") }) in mongosh.',
      );
    });
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
