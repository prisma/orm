import { describe, expect, it } from 'vitest';
import { deleteDocuments } from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';
import { DeleteDocumentsCall } from '../src/core/migrations/op-factory-call';

describe('deleteDocuments', () => {
  it('deletes the documents its filter selects, and checks none is left', () => {
    const op = deleteDocuments({ collection: 'tasks', filter: { type: 'bug' } });
    expect({
      id: op.id,
      name: op.name,
      label: op.label,
      operationClass: op.operationClass,
      precheck: op.precheck,
      run: op.run.map(({ collection, command }) => ({ collection, command: { ...command } })),
      postcheck: op.postcheck.map((check) => check.description),
    }).toEqual({
      id: 'documents.tasks.delete.where({"type":"bug"})',
      name: 'documents.tasks.delete.where({"type":"bug"})',
      label: 'Delete the documents of collection tasks whose type is "bug"',
      operationClass: 'destructive',
      precheck: [],
      run: [
        {
          collection: 'tasks',
          command: { kind: 'rawDeleteMany', collection: 'tasks', filter: { type: 'bug' } },
        },
      ],
      postcheck: ['no document in tasks matches {"type":"bug"}'],
    });
  });

  it('names a filter it cannot put in words by its JSON', () => {
    expect(
      deleteDocuments({ collection: 'tasks', filter: { type: { $in: ['bug', 'epic'] } } }).label,
    ).toBe('Delete the documents of collection tasks matching {"type":{"$in":["bug","epic"]}}');
  });

  it('survives a round trip through ops.json', () => {
    const op = deleteDocuments({ collection: 'tasks', filter: { type: 'bug' } });
    expect(deserializeMongoOps(JSON.parse(serializeMongoOps([op])))).toEqual([op]);
  });
});

describe('DeleteDocumentsCall', () => {
  it('renders the call migration.ts writes, and is destructive', () => {
    const call = new DeleteDocumentsCall({ collection: 'tasks', filter: { type: 'bug' } });
    expect({
      rendered: call.renderTypeScript(),
      operationClass: call.operationClass,
      label: call.label,
      op: call.toOp(),
    }).toEqual({
      rendered: 'deleteDocuments({ collection: "tasks", filter: { type: "bug" } })',
      operationClass: 'destructive',
      label: 'Delete the documents of collection tasks whose type is "bug"',
      op: deleteDocuments({ collection: 'tasks', filter: { type: 'bug' } }),
    });
  });
});
