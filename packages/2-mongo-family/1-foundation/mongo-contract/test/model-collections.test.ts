import type { ApplicationDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { collectionOfModel, embeddingModelOf, modelFieldStoredAs } from '../src/model-collections';

const field = (stored: string) => ({ field: stored });

const domain = {
  namespaces: {
    app: {
      models: {
        Task: {
          fields: { title: {} },
          relations: {},
          storage: { collection: 'tasks', fields: { title: field('title') } },
        },
        Bug: {
          fields: { severity: {} },
          relations: {},
          storage: { fields: { severity: field('sev') } },
          base: { namespace: 'app', model: 'Task' },
        },
        Note: {
          fields: { text: {} },
          relations: {},
          storage: { fields: { text: field('text') } },
          owner: 'Task',
        },
        PinnedNote: {
          fields: {},
          relations: {},
          storage: { fields: {} },
          base: { namespace: 'app', model: 'Note' },
        },
        Lost: { fields: {}, relations: {}, storage: { fields: {} } },
      },
    },
  },
} as unknown as ApplicationDomain;

describe('collectionOfModel', () => {
  it("is the model's own collection, its base's, or its owner's, and none without one", () => {
    expect(
      ['Task', 'Bug', 'Note', 'Lost', 'Missing'].map((model) =>
        collectionOfModel(domain, { namespaceId: 'app', model }),
      ),
    ).toEqual(['tasks', 'tasks', 'tasks', undefined, undefined]);
  });
});

describe('modelFieldStoredAs', () => {
  it('finds the field of a root model or a variant stored in the collection under a name, and not an embedded model', () => {
    expect([
      modelFieldStoredAs(domain, 'tasks', 'title'),
      modelFieldStoredAs(domain, 'tasks', 'sev'),
      modelFieldStoredAs(domain, 'tasks', 'text'),
      modelFieldStoredAs(domain, 'other', 'title'),
    ]).toEqual([
      { namespaceId: 'app', model: 'Task', field: 'title' },
      { namespaceId: 'app', model: 'Bug', field: 'severity' },
      undefined,
      undefined,
    ]);
  });
});

describe('embeddingModelOf', () => {
  it('is the owner of an embedded model or of its base, and none for a root model or a variant', () => {
    expect(
      ['Note', 'PinnedNote', 'Task', 'Bug', 'Missing'].map((model) =>
        embeddingModelOf(domain, { namespaceId: 'app', model }),
      ),
    ).toEqual(['Task', 'Task', undefined, undefined, undefined]);
  });
});
