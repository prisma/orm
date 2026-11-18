import { crossRef } from '@internal/contract/types';
import type { MongoContract } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import {
  modelStoredNamesOf,
  rowOfStoredDocument,
  storedDocumentOfRow,
  storedPathOfCallerPath,
} from '../src/model-stored-names';

const text = { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false, many: false };

const threads = {
  targetFamily: 'mongo',
  roots: {},
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          Comment: {
            fields: { body: text },
            relations: { replies: { to: crossRef('Comment'), cardinality: '1:N' } },
            storage: {
              fields: { body: { field: 'comment_body' } },
              relations: { replies: { field: 'comment_replies' } },
            },
          },
        },
      },
    },
  },
  storage: { namespaces: {} },
} as unknown as MongoContract;

describe('the stored names of a model that embeds itself', () => {
  const comment = modelStoredNamesOf(threads, 'Comment');
  const row = { body: 'a', replies: [{ body: 'b', replies: [{ body: 'c', replies: [] }] }] };
  const document = {
    comment_body: 'a',
    comment_replies: [
      { comment_body: 'b', comment_replies: [{ comment_body: 'c', comment_replies: [] }] },
    ],
  };

  it('writes every level under its stored names', () => {
    expect(storedDocumentOfRow(row, comment)).toEqual(document);
  });

  it('reads every level as fields', () => {
    expect(rowOfStoredDocument(document, comment)).toEqual(row);
  });

  it('translates a dot path below the first level', () => {
    expect(storedPathOfCallerPath(comment, 'replies.0.replies.1.body')).toBe(
      'comment_replies.0.comment_replies.1.comment_body',
    );
  });
});

describe('names every object inherits', () => {
  it.each(['constructor', 'toString'])('are not embed relations: %s', (name) => {
    const comment = modelStoredNamesOf(threads, 'Comment');
    expect([comment.embedded(name), Object.hasOwn(comment.embedStoredNames, name)]).toEqual([
      undefined,
      false,
    ]);
  });
});
