import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import {
  type DocumentMoveOrderInput,
  documentCopiesOf,
  documentMoveOf,
  documentMoveOrder,
} from '../src/core/migrations/mongo-document-moves';
import { type CollectionSpec, contract, schemaCollection } from './mongo-statement-fixtures';

const ADMIN = { collection: 'users', fields: ['_id', 'admin'] };
const USER = { collection: 'users', fields: ['_id', 'user'] };

/** A move of `User`'s documents from `users` to `members`, where `Guest` is stored, in collection `guestsIn` of the origin; the schema has the plan's renames made. */
function moveInput(options: {
  readonly origin?: CollectionSpec;
  readonly destination?: CollectionSpec;
  readonly guestsIn?: string;
  readonly renames?: DocumentMoveOrderInput['collectionRenames'];
}): DocumentMoveOrderInput {
  const guestsIn = options.guestsIn ?? 'members';
  return {
    schema: new MongoSchemaIR(
      [
        schemaCollection('users'),
        ...(options.origin === undefined ? [] : [schemaCollection('members', options.origin)]),
      ],
      { fromDatabase: false },
    ),
    fromContract: contract(
      'from',
      {
        Admin: ADMIN,
        User: USER,
        ...(options.origin === undefined
          ? {}
          : { Guest: { collection: guestsIn, fields: ['_id', 'guest'] } }),
      },
      { users: {}, ...(options.origin === undefined ? {} : { [guestsIn]: options.origin }) },
    ),
    contract: contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: options.destination ?? {} },
    ),
    originFrom: 'users',
    to: 'members',
    collectionRenames: options.renames ?? [],
  };
}

const OPEN = { required: ['guest'] };
const WIDER = { jsonSchema: { bsonType: 'object' } };

describe('documentMoveOrder', () => {
  describe('the operation the move comes after', () => {
    it('is the creation of a new target the plan creates', () => {
      expect(documentMoveOrder(moveInput({ destination: WIDER }))).toEqual({
        after: { kind: 'createCollection' },
        bypassDocumentValidation: false,
        validatorChange: undefined,
      });
    });

    it('is the rename of the collection the plan renames to the target', () => {
      expect(
        documentMoveOrder(
          moveInput({
            origin: {},
            guestsIn: 'guests',
            destination: {},
            renames: [{ from: 'guests', to: 'members' }],
          }),
        ).after,
      ).toEqual({ kind: 'renameCollection', renames: [{ from: 'guests', to: 'members' }] });
    });

    it('is nothing for a target that exists', () => {
      expect(documentMoveOrder(moveInput({ origin: {}, destination: {} })).after).toBeUndefined();
    });

    it('is nothing for a new target an index brings into being', () => {
      expect(
        documentMoveOrder(moveInput({ destination: { unique: ['user'] } })).after,
      ).toBeUndefined();
    });
  });

  describe('skipping document validation', () => {
    it('skips it when the plan replaces the validator the target has', () => {
      expect(documentMoveOrder(moveInput({ origin: OPEN, destination: WIDER }))).toMatchObject({
        bypassDocumentValidation: true,
        validatorChange: 'replaced',
      });
    });

    it('skips it when the plan replaces the validator of the collection renamed to the target', () => {
      expect(
        documentMoveOrder(
          moveInput({
            origin: OPEN,
            guestsIn: 'guests',
            destination: WIDER,
            renames: [{ from: 'guests', to: 'members' }],
          }),
        ),
      ).toMatchObject({
        after: { kind: 'renameCollection', renames: [{ from: 'guests', to: 'members' }] },
        bypassDocumentValidation: true,
        validatorChange: 'replaced',
      });
    });

    it('skips it when the plan removes the validator the target has', () => {
      expect(documentMoveOrder(moveInput({ origin: OPEN, destination: {} }))).toMatchObject({
        bypassDocumentValidation: true,
        validatorChange: 'removed',
      });
    });

    it('keeps it when the plan adds a validator to a target that has none', () => {
      expect(documentMoveOrder(moveInput({ origin: {}, destination: WIDER }))).toMatchObject({
        bypassDocumentValidation: false,
        validatorChange: undefined,
      });
    });

    it('keeps it when the target keeps its validator', () => {
      expect(documentMoveOrder(moveInput({ origin: OPEN, destination: OPEN }))).toMatchObject({
        bypassDocumentValidation: false,
        validatorChange: undefined,
      });
    });

    it("keeps it when the target's control policy leaves its validator change out of the plan", () => {
      expect(
        documentMoveOrder(
          moveInput({ origin: OPEN, destination: { ...WIDER, control: 'external' } }),
        ),
      ).toMatchObject({ bypassDocumentValidation: false, validatorChange: undefined });
    });

    it('keeps it for a target the plan creates with its validator', () => {
      expect(documentMoveOrder(moveInput({ destination: OPEN }))).toMatchObject({
        after: { kind: 'createCollection' },
        bypassDocumentValidation: false,
      });
    });
  });
});

describe('documentMoveOf', () => {
  it('reads the source under its origin name when the plan does not rename it', () => {
    expect(documentMoveOf(moveInput({ origin: {}, destination: {} }), [])).toMatchObject({
      from: 'users',
      to: 'members',
    });
  });

  it('reads the source under the name the plan renames it to, right after that rename', () => {
    expect(
      documentMoveOf(
        moveInput({ origin: {}, destination: {}, renames: [{ from: 'users', to: 'people' }] }),
        [],
      ),
    ).toMatchObject({
      from: 'people',
      to: 'members',
      order: { after: { kind: 'renameCollection', renames: [{ from: 'users', to: 'people' }] } },
    });
  });
});

describe('documentCopiesOf', () => {
  it("writes the moving model's stored-name changes into its copy", () => {
    expect(
      documentCopiesOf([
        {
          name: 'User',
          storedNameMoves: [
            { from: 'name', to: 'fullName' },
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' },
          ],
          droppedStoredNames: [],
          variant: undefined,
        },
      ]),
    ).toEqual([
      {
        models: ['User'],
        droppedStoredNames: [],
        fieldStages: [{ $set: { fullName: '$name', b: '$a', a: '$b' } }, { $unset: ['name'] }],
      },
    ]);
  });

  it('copies models whose documents change alike together', () => {
    expect(
      documentCopiesOf([
        { name: 'Admin', storedNameMoves: [], droppedStoredNames: [], variant: undefined },
        { name: 'Staff', storedNameMoves: [], droppedStoredNames: [], variant: undefined },
      ]),
    ).toEqual([{ models: ['Admin', 'Staff'], droppedStoredNames: [], fieldStages: [] }]);
  });

  it('gives each model its own copy when one renames a field the other keeps', () => {
    expect(
      documentCopiesOf([
        {
          name: 'Admin',
          storedNameMoves: [{ from: 'n', to: 'name' }],
          droppedStoredNames: [],
          variant: undefined,
        },
        { name: 'Staff', storedNameMoves: [], droppedStoredNames: [], variant: undefined },
      ]),
    ).toEqual([
      {
        models: ['Admin'],
        droppedStoredNames: [],
        fieldStages: [{ $set: { name: '$n' } }, { $unset: ['n'] }],
      },
      { models: ['Staff'], droppedStoredNames: [], fieldStages: [] },
    ]);
  });

  it('gives each model its own copy when their fields move to the same stored name', () => {
    expect(
      documentCopiesOf([
        {
          name: 'Admin',
          storedNameMoves: [{ from: 'a', to: 'x' }],
          droppedStoredNames: [],
          variant: undefined,
        },
        {
          name: 'Staff',
          storedNameMoves: [{ from: 'b', to: 'x' }],
          droppedStoredNames: [],
          variant: undefined,
        },
      ]),
    ).toEqual([
      {
        models: ['Admin'],
        droppedStoredNames: [],
        fieldStages: [{ $set: { x: '$a' } }, { $unset: ['a'] }],
      },
      {
        models: ['Staff'],
        droppedStoredNames: [],
        fieldStages: [{ $set: { x: '$b' } }, { $unset: ['b'] }],
      },
    ]);
  });

  it('sets the discriminator value of a model that becomes a variant in the target', () => {
    expect(
      documentCopiesOf([
        {
          name: 'User',
          storedNameMoves: [{ from: 'name', to: 'fullName' }],
          droppedStoredNames: [],
          variant: { field: 'kind', value: 'member' },
        },
      ]),
    ).toEqual([
      {
        models: ['User'],
        droppedStoredNames: [],
        fieldStages: [
          { $set: { fullName: '$name', kind: { $literal: 'member' } } },
          { $unset: ['name'] },
        ],
      },
    ]);
  });

  it('drops the stored names the destination model does not store', () => {
    expect(
      documentCopiesOf([
        {
          name: 'User',
          storedNameMoves: [{ from: 'name', to: 'fullName' }],
          droppedStoredNames: ['extra'],
          variant: undefined,
        },
      ]),
    ).toEqual([
      {
        models: ['User'],
        droppedStoredNames: ['extra'],
        fieldStages: [{ $set: { fullName: '$name' } }, { $unset: ['name', 'extra'] }],
      },
    ]);
  });

  it('gives a model that drops a field its own copy', () => {
    expect(
      documentCopiesOf([
        { name: 'Admin', storedNameMoves: [], droppedStoredNames: ['extra'], variant: undefined },
        { name: 'Staff', storedNameMoves: [], droppedStoredNames: [], variant: undefined },
      ]),
    ).toEqual([
      { models: ['Admin'], droppedStoredNames: ['extra'], fieldStages: [{ $unset: ['extra'] }] },
      { models: ['Staff'], droppedStoredNames: [], fieldStages: [] },
    ]);
  });
});
