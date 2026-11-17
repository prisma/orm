import { MongoExistsExpr } from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { renameField, unsetField } from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';
import { RenameFieldCall, UnsetFieldCall } from '../src/core/migrations/op-factory-call';

const meta = { target: 'mongo', storageHash: '', lane: 'mongo-raw' };

function noDocumentHolds(collection: string, match: Record<string, unknown>, description: string) {
  return {
    description,
    source: {
      collection,
      command: new RawAggregateCommand(collection, [{ $match: match }, { $limit: 1 }]),
      meta,
    },
    filter: MongoExistsExpr.exists('_id'),
    expect: 'notExists' as const,
  };
}

describe('renameField', () => {
  it('renames the field on every document that holds it, skipping validation', () => {
    const op = renameField('users', 'name', 'fullName');

    expect(op).toEqual({
      id: 'field.users.name.rename(fullName)',
      label: 'Rename field name to fullName in collection users',
      operationClass: 'widening',
      name: 'field.users.name.rename(fullName)',
      precheck: [
        noDocumentHolds(
          'users',
          { $and: [{ name: { $exists: true } }, { fullName: { $exists: true } }] },
          'no document in users holds both name and fullName',
        ),
      ],
      run: [
        {
          collection: 'users',
          command: new RawUpdateManyCommand(
            'users',
            { name: { $exists: true } },
            { $rename: { name: 'fullName' } },
            { bypassDocumentValidation: true },
          ),
          meta,
        },
      ],
      postcheck: [
        noDocumentHolds('users', { name: { $exists: true } }, 'no document in users holds name'),
      ],
    });
  });

  it('limits the rename and its checks to documents that match the filter', () => {
    const op = renameField('posts', 'title', 'headline', { filter: { type: 'bug' } });

    expect({
      id: op.id,
      label: op.label,
      precheck: op.precheck[0]?.source.command,
      run: op.run[0]?.command,
      postcheck: op.postcheck[0]?.source.command,
    }).toEqual({
      id: 'field.posts.title.rename(headline).where({"type":"bug"})',
      label: 'Rename field title to headline in collection posts in documents whose type is "bug"',
      precheck: new RawAggregateCommand('posts', [
        {
          $match: {
            $and: [{ type: 'bug' }, { title: { $exists: true } }, { headline: { $exists: true } }],
          },
        },
        { $limit: 1 },
      ]),
      run: new RawUpdateManyCommand(
        'posts',
        { $and: [{ type: 'bug' }, { title: { $exists: true } }] },
        { $rename: { title: 'headline' } },
        { bypassDocumentValidation: true },
      ),
      postcheck: new RawAggregateCommand('posts', [
        { $match: { $and: [{ type: 'bug' }, { title: { $exists: true } }] } },
        { $limit: 1 },
      ]),
    });
  });
});

describe('unsetField', () => {
  it('removes the field from every document that holds it, skipping validation', () => {
    expect(unsetField('users', 'nickname')).toEqual({
      id: 'field.users.nickname.unset',
      label: 'Remove field nickname from collection users',
      operationClass: 'destructive',
      name: 'field.users.nickname.unset',
      precheck: [],
      run: [
        {
          collection: 'users',
          command: new RawUpdateManyCommand(
            'users',
            { nickname: { $exists: true } },
            { $unset: { nickname: '' } },
            { bypassDocumentValidation: true },
          ),
          meta,
        },
      ],
      postcheck: [
        noDocumentHolds(
          'users',
          { nickname: { $exists: true } },
          'no document in users holds nickname',
        ),
      ],
    });
  });

  it('limits the removal to documents that match the filter', () => {
    const op = unsetField('posts', 'score', { filter: { type: 'bug' } });

    expect({ id: op.id, run: op.run[0]?.command }).toEqual({
      id: 'field.posts.score.unset.where({"type":"bug"})',
      run: new RawUpdateManyCommand(
        'posts',
        { $and: [{ type: 'bug' }, { score: { $exists: true } }] },
        { $unset: { score: '' } },
        { bypassDocumentValidation: true },
      ),
    });
  });
});

describe('field rewrite labels', () => {
  it('describe the documents a filter selects in words', () => {
    expect([
      unsetField('tasks', 'note', { filter: { type: { $nin: ['bug', 'task'] } } }).label,
      unsetField('tasks', 'note', { filter: { type: { $in: ['bug'] } } }).label,
    ]).toEqual([
      'Remove field note from collection tasks in documents whose type is none of "bug", "task"',
      'Remove field note from collection tasks in documents matching {"type":{"$in":["bug"]}}',
    ]);
  });
});

describe('field names a rewrite refuses', () => {
  const refusals = [
    { field: 'a.b', reason: 'contains "."' },
    { field: '$a', reason: 'starts with "$"' },
    { field: '_id', reason: 'is _id' },
    { field: '', reason: 'is empty' },
  ];

  for (const { field, reason } of refusals) {
    it(`refuses a field name that ${reason}`, () => {
      const expected = expect.objectContaining({
        code: 'MIGRATION.FIELD_NAME_UNSUPPORTED',
        meta: expect.objectContaining({ collection: 'users', field }),
      });
      expect(() => renameField('users', field, 'x')).toThrow(expected);
      expect(() => renameField('users', 'x', field)).toThrow(expected);
      expect(() => unsetField('users', field)).toThrow(expected);
      expect(() => new RenameFieldCall('users', field, 'x')).toThrow(expected);
      expect(() => new UnsetFieldCall('users', field)).toThrow(expected);
    });
  }

  it('refuses renaming a field to its own name as an invalid operation, not an unsupported name', () => {
    expect(() => renameField('users', 'name', 'name')).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        meta: expect.objectContaining({
          context: 'renameField',
          collection: 'users',
          field: 'name',
          reason: 'the new name is the old name',
        }),
      }),
    );
  });
});

describe('field rewrite calls', () => {
  it('RenameFieldCall is widening, renders renameField(...) and lowers to renameField', () => {
    const plain = new RenameFieldCall('users', 'name', 'fullName');
    const filtered = new RenameFieldCall('posts', 'title', 'headline', { type: 'bug' });

    expect({
      frozen: Object.isFrozen(plain),
      operationClass: plain.operationClass,
      label: plain.label,
      plain: plain.renderTypeScript(),
      filtered: filtered.renderTypeScript(),
      imports: plain.importRequirements(),
    }).toEqual({
      frozen: true,
      operationClass: 'widening',
      label: 'Rename field name to fullName in collection users',
      plain: 'renameField("users", "name", "fullName")',
      filtered: 'renameField("posts", "title", "headline", { filter: { type: "bug" } })',
      imports: [{ moduleSpecifier: '@internal/target-mongo/migration', symbol: 'renameField' }],
    });
    expect(filtered.toOp()).toEqual(
      renameField('posts', 'title', 'headline', { filter: { type: 'bug' } }),
    );
  });

  it('UnsetFieldCall is destructive, renders unsetField(...) and lowers to unsetField', () => {
    const plain = new UnsetFieldCall('users', 'nickname');
    const filtered = new UnsetFieldCall('posts', 'score', { type: 'bug' });

    expect({
      frozen: Object.isFrozen(plain),
      operationClass: plain.operationClass,
      label: plain.label,
      plain: plain.renderTypeScript(),
      filtered: filtered.renderTypeScript(),
      imports: plain.importRequirements(),
    }).toEqual({
      frozen: true,
      operationClass: 'destructive',
      label: 'Remove field nickname from collection users',
      plain: 'unsetField("users", "nickname")',
      filtered: 'unsetField("posts", "score", { filter: { type: "bug" } })',
      imports: [{ moduleSpecifier: '@internal/target-mongo/migration', symbol: 'unsetField' }],
    });
    expect(filtered.toOp()).toEqual(unsetField('posts', 'score', { filter: { type: 'bug' } }));
  });
});

describe('field rewrite serialization', () => {
  it('round-trips both rewrites with their classes, told apart from DDL by their shape', () => {
    const ops = [
      renameField('posts', 'title', 'headline', { filter: { type: 'bug' } }),
      unsetField('users', 'nickname'),
    ];

    expect(deserializeMongoOps(JSON.parse(serializeMongoOps(ops)))).toEqual(ops);
  });
});
