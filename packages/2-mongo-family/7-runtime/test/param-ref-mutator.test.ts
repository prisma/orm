import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { createMongoParamRefMutator, flattenMongoParamRefs } from '../src/param-ref-mutator';

// ─── flattenMongoParamRefs ──────────────────────────────────────────────────

describe('flattenMongoParamRefs', () => {
  it('yields MongoParamRef nodes from insertOne document fields', () => {
    const ref = new MongoParamRef('Alice');
    const draft: MongoLoweredDraft = {
      kind: 'insertOne',
      collection: 'users',
      document: { name: ref, age: 30 },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields MongoParamRef nodes nested inside object values', () => {
    const ref = new MongoParamRef('value');
    const draft: MongoLoweredDraft = {
      kind: 'insertOne',
      collection: 'users',
      document: { meta: { nested: ref } },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields MongoParamRef nodes inside array elements', () => {
    const ref1 = new MongoParamRef('a');
    const ref2 = new MongoParamRef('b');
    const draft: MongoLoweredDraft = {
      kind: 'insertMany',
      collection: 'users',
      documents: [{ name: ref1 }, { name: ref2 }],
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref1, ref2]);
  });

  it('yields MongoParamRef leaves from filter predicates', () => {
    const ref = new MongoParamRef('active');
    const draft: MongoLoweredDraft = {
      kind: 'deleteOne',
      collection: 'users',
      filter: { status: { $eq: ref } },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields MongoParamRef leaves from aggregate pipeline stages', () => {
    const ref = new MongoParamRef(10);
    const draft: MongoLoweredDraft = {
      kind: 'aggregate',
      collection: 'orders',
      pipeline: [{ $match: { amount: { $gt: ref } } }],
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([ref]);
  });

  it('yields zero entries for a raw aggregate command', () => {
    const draft: MongoLoweredDraft = {
      kind: 'rawAggregate',
      collection: 'orders',
      pipeline: [{ $match: { amount: { $gt: 10 } } }],
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([]);
  });

  it('yields zero entries for a raw insertOne command', () => {
    const draft: MongoLoweredDraft = {
      kind: 'rawInsertOne',
      collection: 'users',
      document: { name: 'Alice' },
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([]);
  });

  it('yields MongoParamRef nodes from updateOne filter and update', () => {
    const filterRef = new MongoParamRef('userId');
    const updateRef = new MongoParamRef('newRole');
    const draft: MongoLoweredDraft = {
      kind: 'updateOne',
      collection: 'users',
      filter: { id: { $eq: filterRef } },
      update: { $set: { role: updateRef } },
      upsert: false,
    };
    expect([...flattenMongoParamRefs(draft)]).toEqual([filterRef, updateRef]);
  });

  it.each([
    {
      label: 'updateMany',
      draft: {
        kind: 'updateMany',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
        update: { $set: { active: new MongoParamRef(true) } },
        upsert: undefined,
      } satisfies MongoLoweredDraft,
      expectedLength: 2,
    },
    {
      label: 'deleteOne',
      draft: {
        kind: 'deleteOne',
        collection: 'users',
        filter: { id: new MongoParamRef('x') },
      } satisfies MongoLoweredDraft,
      expectedLength: 1,
    },
    {
      label: 'findOneAndUpdate',
      draft: {
        kind: 'findOneAndUpdate',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
        update: { $set: { v: new MongoParamRef('next') } },
        upsert: true,
        sort: { _id: 1 as const },
        returnDocument: 'after' as const,
      } satisfies MongoLoweredDraft,
      expectedLength: 2,
    },
    {
      label: 'findOneAndDelete',
      draft: {
        kind: 'findOneAndDelete',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
        sort: undefined,
      } satisfies MongoLoweredDraft,
      expectedLength: 1,
    },
    {
      label: 'rawInsertMany',
      draft: {
        kind: 'rawInsertMany',
        collection: 'users',
        documents: [{ name: new MongoParamRef('a') }],
      } satisfies MongoLoweredDraft,
      expectedLength: 1,
    },
    {
      label: 'rawUpdateOne',
      draft: {
        kind: 'rawUpdateOne',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
        update: [{ $set: { v: new MongoParamRef(2) } }],
      } satisfies MongoLoweredDraft,
      expectedLength: 2,
    },
    {
      label: 'rawUpdateMany',
      draft: {
        kind: 'rawUpdateMany',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
        update: { $set: { v: new MongoParamRef(2) } },
      } satisfies MongoLoweredDraft,
      expectedLength: 2,
    },
    {
      label: 'rawDeleteOne',
      draft: {
        kind: 'rawDeleteOne',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
      } satisfies MongoLoweredDraft,
      expectedLength: 1,
    },
    {
      label: 'rawDeleteMany',
      draft: {
        kind: 'rawDeleteMany',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
      } satisfies MongoLoweredDraft,
      expectedLength: 1,
    },
    {
      label: 'rawFindOneAndUpdate',
      draft: {
        kind: 'rawFindOneAndUpdate',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
        update: { $set: { v: new MongoParamRef(2) } },
        upsert: false,
        sort: undefined,
        returnDocument: undefined,
      } satisfies MongoLoweredDraft,
      expectedLength: 2,
    },
    {
      label: 'rawFindOneAndDelete',
      draft: {
        kind: 'rawFindOneAndDelete',
        collection: 'users',
        filter: { id: new MongoParamRef(1) },
        sort: undefined,
      } satisfies MongoLoweredDraft,
      expectedLength: 1,
    },
  ] as const)('flattens $label drafts', ({ draft, expectedLength }) => {
    expect([...flattenMongoParamRefs(draft)]).toHaveLength(expectedLength);
  });
});

// ─── createMongoParamRefMutator ─────────────────────────────────────────────

describe('createMongoParamRefMutator', () => {
  describe('entries()', () => {
    it('yields one entry per MongoParamRef in the draft', () => {
      const ref1 = new MongoParamRef('Alice', { codecId: 'string' });
      const ref2 = new MongoParamRef(42, { codecId: 'int' });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref1, age: ref2 },
      };
      const mutator = createMongoParamRefMutator(draft);
      const entries = [...mutator.entries()];
      expect(entries).toHaveLength(2);
      expect(entries[0]!.value).toBe('Alice');
      expect(entries[0]!.codecId).toBe('string');
      expect(entries[1]!.value).toBe(42);
      expect(entries[1]!.codecId).toBe('int');
    });

    it('yields zero entries for raw commands', () => {
      const draft: MongoLoweredDraft = {
        kind: 'rawInsertOne',
        collection: 'users',
        document: { name: 'Alice' },
      };
      const mutator = createMongoParamRefMutator(draft);
      expect([...mutator.entries()]).toEqual([]);
    });

    it('reflects replaced values in subsequent entries() calls', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);
      const [updated] = [...mutator.entries()];
      expect(updated!.value).toBe('Bob');
    });
  });

  describe('replaceValue() / replaceValues() — write-through', () => {
    it('replaceValues writes the new value and currentDraft() reflects it', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);

      const updated = mutator.currentDraft();
      expect(updated.kind).toBe('insertOne');
      if (updated.kind === 'insertOne') {
        const nameRef = updated.document['name'];
        expect(nameRef).toBeInstanceOf(MongoParamRef);
        expect((nameRef as MongoParamRef).value).toBe('Bob');
      }
    });

    it('keeps the name, codec id and collection of a parameter it replaces', () => {
      const ref = new MongoParamRef('Alice', {
        name: 'profile.name',
        codecId: 'mongo/string@1',
        collection: 'users',
      });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { profile: { name: ref } },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);

      expect([...flattenMongoParamRefs(mutator.currentDraft())]).toEqual([
        new MongoParamRef('Bob', {
          name: 'profile.name',
          codecId: 'mongo/string@1',
          collection: 'users',
        }),
      ]);
    });

    it('replaceValue with typed codecId-matched handle writes the new value', () => {
      const ref = new MongoParamRef('Alice', { codecId: 'encrypt' });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator<{ encrypt: string }>(draft);
      const [entry] = [...mutator.entries()];
      if (entry?.codecId === 'encrypt') {
        mutator.replaceValue(entry.ref, 'EncryptedAlice');
      }

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        expect((updated.document['name'] as MongoParamRef).value).toBe('EncryptedAlice');
      }
    });

    it('replaceValues writes multiple values at once', () => {
      const ref1 = new MongoParamRef('Alice');
      const ref2 = new MongoParamRef('admin');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref1, role: ref2 },
      };
      const mutator = createMongoParamRefMutator(draft);
      const entries = [...mutator.entries()];

      mutator.replaceValues([
        { ref: entries[0]!.ref, newValue: 'Bob' },
        { ref: entries[1]!.ref, newValue: 'moderator' },
      ]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        expect((updated.document['name'] as MongoParamRef).value).toBe('Bob');
        expect((updated.document['role'] as MongoParamRef).value).toBe('moderator');
      }
    });

    it('preserves codecId and name on replaced MongoParamRef nodes', () => {
      const ref = new MongoParamRef('Alice', { codecId: 'encrypt', name: 'nameParam' });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'EncryptedBob' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        const nameRef = updated.document['name'] as MongoParamRef;
        expect(nameRef.value).toBe('EncryptedBob');
        expect(nameRef.codecId).toBe('encrypt');
        expect(nameRef.name).toBe('nameParam');
      }
    });

    it('handles replacement in nested objects', () => {
      const ref = new MongoParamRef('secret');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { profile: { ssn: ref } },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'encrypted-secret' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        const profile = updated.document['profile'] as Record<string, unknown>;
        expect((profile['ssn'] as MongoParamRef).value).toBe('encrypted-secret');
      }
    });

    it('handles replacement in array elements', () => {
      const ref1 = new MongoParamRef('Alice');
      const ref2 = new MongoParamRef('Bob');
      const draft: MongoLoweredDraft = {
        kind: 'insertMany',
        collection: 'users',
        documents: [{ name: ref1 }, { name: ref2 }],
      };
      const mutator = createMongoParamRefMutator(draft);
      const entries = [...mutator.entries()];
      mutator.replaceValues([{ ref: entries[0]!.ref, newValue: 'enc-Alice' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertMany') {
        expect((updated.documents[0]!['name'] as MongoParamRef).value).toBe('enc-Alice');
        expect((updated.documents[1]!['name'] as MongoParamRef).value).toBe('Bob');
      }
    });

    it('handles replacement inside array-valued document fields', () => {
      const ref = new MongoParamRef('draft');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { tags: [ref] },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'published' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        const tags = updated.document['tags'] as MongoParamRef[];
        expect(tags[0]!.value).toBe('published');
      }
    });

    it('leaves primitive document slots unchanged', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { count: 3, name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'insertOne') {
        expect(updated.document['count']).toBe(3);
        expect((updated.document['name'] as MongoParamRef).value).toBe('Bob');
      }
    });

    it('rebuilds rawInsertOne and updateOne drafts', () => {
      const rawRef = new MongoParamRef('raw');
      const rawDraft: MongoLoweredDraft = {
        kind: 'rawInsertOne',
        collection: 'users',
        document: { token: rawRef },
      };
      const rawMutator = createMongoParamRefMutator(rawDraft);
      const [rawEntry] = [...rawMutator.entries()];
      rawMutator.replaceValues([{ ref: rawEntry!.ref, newValue: 'sealed' }]);
      const rawUpdated = rawMutator.currentDraft();
      if (rawUpdated.kind === 'rawInsertOne') {
        expect((rawUpdated.document['token'] as MongoParamRef).value).toBe('sealed');
      }

      const filterRef = new MongoParamRef(1);
      const updateRef = new MongoParamRef('admin');
      const updateDraft: MongoLoweredDraft = {
        kind: 'updateOne',
        collection: 'users',
        filter: { id: filterRef },
        update: { $set: { role: updateRef } },
        upsert: false,
      };
      const updateMutator = createMongoParamRefMutator(updateDraft);
      const updateEntries = [...updateMutator.entries()];
      updateMutator.replaceValues([{ ref: updateEntries[1]!.ref, newValue: 'moderator' }]);
      const updateUpdated = updateMutator.currentDraft();
      if (updateUpdated.kind === 'updateOne') {
        const set = (updateUpdated.update as Record<string, unknown>)['$set'] as Record<
          string,
          unknown
        >;
        expect((set['role'] as MongoParamRef).value).toBe('moderator');
      }
    });

    it('handles replacement in filter predicates', () => {
      const ref = new MongoParamRef('active');
      const draft: MongoLoweredDraft = {
        kind: 'deleteMany',
        collection: 'users',
        filter: { status: { $eq: ref } },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'inactive' }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'deleteMany') {
        const status = updated.filter['status'] as Record<string, unknown>;
        expect((status['$eq'] as MongoParamRef).value).toBe('inactive');
      }
    });

    it('handles replacement in pipeline stage values', () => {
      const ref = new MongoParamRef(100);
      const draft: MongoLoweredDraft = {
        kind: 'aggregate',
        collection: 'orders',
        pipeline: [{ $match: { amount: { $gt: ref } } }],
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 200 }]);

      const updated = mutator.currentDraft();
      if (updated.kind === 'aggregate') {
        const match = updated.pipeline[0]!['$match'] as Record<string, unknown>;
        const amount = match['amount'] as Record<string, unknown>;
        expect((amount['$gt'] as MongoParamRef).value).toBe(200);
      }
    });

    it('replaceValue applies a single handle update', () => {
      const ref = new MongoParamRef('before', { codecId: 'string' });
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { token: ref },
      };
      const mutator = createMongoParamRefMutator<{ string: string }>(draft);
      const [entry] = [...mutator.entries()];
      if (entry?.codecId === 'string') {
        mutator.replaceValue(entry.ref, 'after');
      }

      const updated = mutator.currentDraft();
      expect(updated.kind).toBe('insertOne');
      if (updated.kind === 'insertOne') {
        expect((updated.document['token'] as MongoParamRef).value).toBe('after');
      }
    });

    it.each([
      {
        label: 'updateMany',
        refIndex: 1,
        draft: {
          kind: 'updateMany',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
          update: { $set: { active: new MongoParamRef(false) } },
          upsert: undefined,
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'updateMany') throw new Error('wrong kind');
          return (updated.update as Record<string, unknown>)['$set'] as Record<string, unknown>;
        },
        field: 'active',
      },
      {
        label: 'deleteOne',
        refIndex: 0,
        draft: {
          kind: 'deleteOne',
          collection: 'users',
          filter: { id: new MongoParamRef('old') },
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'deleteOne') throw new Error('wrong kind');
          return updated.filter;
        },
        field: 'id',
      },
      {
        label: 'findOneAndUpdate',
        refIndex: 1,
        draft: {
          kind: 'findOneAndUpdate',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
          update: { $set: { v: new MongoParamRef('a') } },
          upsert: false,
          sort: undefined,
          returnDocument: 'before' as const,
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'findOneAndUpdate') throw new Error('wrong kind');
          return (updated.update as Record<string, unknown>)['$set'] as Record<string, unknown>;
        },
        field: 'v',
      },
      {
        label: 'findOneAndDelete',
        refIndex: 0,
        draft: {
          kind: 'findOneAndDelete',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
          sort: { _id: -1 as const },
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'findOneAndDelete') throw new Error('wrong kind');
          return updated.filter;
        },
        field: 'id',
      },
      {
        label: 'rawInsertMany',
        refIndex: 0,
        draft: {
          kind: 'rawInsertMany',
          collection: 'users',
          documents: [{ name: new MongoParamRef('a') }],
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawInsertMany') throw new Error('wrong kind');
          return updated.documents[0]!;
        },
        field: 'name',
      },
      {
        label: 'rawUpdateOne pipeline',
        refIndex: 1,
        draft: {
          kind: 'rawUpdateOne',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
          update: [{ $set: { v: new MongoParamRef(0) } }],
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawUpdateOne') throw new Error('wrong kind');
          const stage = (updated.update as ReadonlyArray<Record<string, unknown>>)[0]!;
          return stage['$set'] as Record<string, unknown>;
        },
        field: 'v',
      },
      {
        label: 'rawFindOneAndUpdate',
        refIndex: 1,
        draft: {
          kind: 'rawFindOneAndUpdate',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
          update: { $set: { v: new MongoParamRef(0) } },
          upsert: true,
          sort: undefined,
          returnDocument: undefined,
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawFindOneAndUpdate') throw new Error('wrong kind');
          return (updated.update as Record<string, unknown>)['$set'] as Record<string, unknown>;
        },
        field: 'v',
      },
      {
        label: 'rawUpdateMany',
        refIndex: 1,
        draft: {
          kind: 'rawUpdateMany',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
          update: { $set: { v: new MongoParamRef(0) } },
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawUpdateMany') throw new Error('wrong kind');
          return (updated.update as Record<string, unknown>)['$set'] as Record<string, unknown>;
        },
        field: 'v',
      },
      {
        label: 'rawDeleteOne',
        refIndex: 0,
        draft: {
          kind: 'rawDeleteOne',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawDeleteOne') throw new Error('wrong kind');
          return updated.filter;
        },
        field: 'id',
      },
      {
        label: 'rawDeleteMany',
        refIndex: 0,
        draft: {
          kind: 'rawDeleteMany',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawDeleteMany') throw new Error('wrong kind');
          return updated.filter;
        },
        field: 'id',
      },
      {
        label: 'rawFindOneAndDelete',
        refIndex: 0,
        draft: {
          kind: 'rawFindOneAndDelete',
          collection: 'users',
          filter: { id: new MongoParamRef(1) },
          sort: undefined,
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawFindOneAndDelete') throw new Error('wrong kind');
          return updated.filter;
        },
        field: 'id',
      },
      {
        label: 'rawAggregate pipeline',
        refIndex: 0,
        draft: {
          kind: 'rawAggregate',
          collection: 'orders',
          pipeline: [{ $match: { amount: { $gt: new MongoParamRef(1) } } }],
        } satisfies MongoLoweredDraft,
        read: (updated: MongoLoweredDraft) => {
          if (updated.kind !== 'rawAggregate') throw new Error('wrong kind');
          const match = updated.pipeline[0]!['$match'] as Record<string, unknown>;
          return match['amount'] as Record<string, unknown>;
        },
        field: '$gt',
      },
    ])('rebuilds $label draft after replacement', ({ draft, read, field, refIndex }) => {
      const mutator = createMongoParamRefMutator(draft);
      const entries = [...mutator.entries()];
      mutator.replaceValues([{ ref: entries[refIndex]!.ref, newValue: 'mutated' }]);
      const slot = read(mutator.currentDraft());
      expect((slot[field] as MongoParamRef).value).toBe('mutated');
    });
  });

  it('reuses the overrides map across sequential replacements', () => {
    const ref1 = new MongoParamRef('a', { codecId: 'string' });
    const ref2 = new MongoParamRef('b', { codecId: 'string' });
    const draft: MongoLoweredDraft = {
      kind: 'insertOne',
      collection: 'users',
      document: { first: ref1, second: ref2 },
    };
    const mutator = createMongoParamRefMutator<{ string: string }>(draft);
    const entries = [...mutator.entries()];
    const first = entries.find((e) => e.value === 'a');
    const second = entries.find((e) => e.value === 'b');
    if (first?.codecId === 'string') {
      mutator.replaceValue(first.ref, 'A');
    }
    if (second?.codecId === 'string') {
      mutator.replaceValue(second.ref, 'B');
    }

    const reread = [...mutator.entries()];
    expect(reread.find((e) => e.codecId === 'string' && e.value === 'A')).toBeDefined();
    expect(reread.find((e) => e.codecId === 'string' && e.value === 'B')).toBeDefined();

    const updated = mutator.currentDraft();
    if (updated.kind === 'insertOne') {
      expect((updated.document['first'] as MongoParamRef).value).toBe('A');
      expect((updated.document['second'] as MongoParamRef).value).toBe('B');
    }
  });

  describe('reference-identity fast path', () => {
    it('returns the original draft by reference when nothing is replaced', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      expect(mutator.currentDraft()).toBe(draft);
    });

    it('returns a new object (not the original) after any replacement', () => {
      const ref = new MongoParamRef('Alice');
      const draft: MongoLoweredDraft = {
        kind: 'insertOne',
        collection: 'users',
        document: { name: ref },
      };
      const mutator = createMongoParamRefMutator(draft);
      const [entry] = [...mutator.entries()];
      mutator.replaceValues([{ ref: entry!.ref, newValue: 'Bob' }]);
      expect(mutator.currentDraft()).not.toBe(draft);
    });
  });
});
