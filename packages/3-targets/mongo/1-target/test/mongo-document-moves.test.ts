import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import {
  type DocumentMoveOrderInput,
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
  readonly rewritten?: readonly string[];
  readonly storedNameMoves?: DocumentMoveOrderInput['storedNameMoves'];
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
    from: 'users',
    to: 'members',
    collectionRenames: options.renames ?? [],
    rewrittenCollections: new Set(options.rewritten ?? []),
    storedNameMoves: options.storedNameMoves ?? [],
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
        twoPlans: false,
        fieldStages: [],
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
      ).toEqual({ kind: 'renameCollection', from: 'guests' });
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
        after: { kind: 'renameCollection', from: 'guests' },
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

  it('asks for two plans when the plan rewrites documents in the target', () => {
    expect(
      documentMoveOrder(moveInput({ origin: OPEN, destination: WIDER, rewritten: ['members'] }))
        .twoPlans,
    ).toBe(true);
  });

  it("writes the moving model's stored-name changes into the copy", () => {
    expect(
      documentMoveOrder(
        moveInput({
          destination: WIDER,
          storedNameMoves: [
            { from: 'name', to: 'fullName' },
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' },
          ],
        }),
      ).fieldStages,
    ).toEqual([{ $set: { fullName: '$name', b: '$a', a: '$b' } }, { $unset: ['name'] }]);
  });

  it('refuses a move whose source collection the plan renames', () => {
    expect(() =>
      documentMoveOrder(moveInput({ renames: [{ from: 'users', to: 'people' }] })),
    ).toThrow('A document move reads collection "users", which the plan renames');
  });
});
