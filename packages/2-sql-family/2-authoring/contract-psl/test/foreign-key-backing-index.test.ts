import { describe, expect, it, vi } from 'vitest';
import {
  backingIndex,
  buildFromPsl,
  buildFromTs,
  expectBothBuilds,
  foreignKeyNaming,
  hashIndex,
  namedIndex,
  partialIndex,
} from './foreign-key-backing-index.support';

describe("a relation's backing index", () => {
  it('is derived when the table has no index on the foreign key columns', () => {
    expectBothBuilds({ psl: {}, ts: {} }).toEqual({
      indexes: [backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it('is the identical unnamed index the table declares', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId])' },
      ts: { indexes: ['unnamed'] },
    }).toEqual({
      indexes: [backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it('is the identical named index the table declares', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId], name: "post_author")' },
      ts: { indexes: ['named'] },
    }).toEqual({
      indexes: [namedIndex],
      foreignKeys: [foreignKeyNaming({ name: namedIndex.name })],
    });
  });

  it('is derived beside a partial index on the foreign key columns', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId], where: sql`id > 0`, name: "post_author_live")' },
      ts: { indexes: ['partial'] },
    }).toEqual({
      indexes: [partialIndex, backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it('is derived beside a typed index on the foreign key columns', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId], type: "hash", options: {}, name: "post_author_hash")' },
      ts: { indexes: ['hash'] },
    }).toEqual({
      indexes: [hashIndex, backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it.each([
    ['an unnamed unique constraint', '@unique', 'unique', { unique: ['authorId'] }],
    [
      'a named unique constraint',
      '@unique(map: "post_author_key")',
      'namedUnique',
      { unique: ['authorId'] },
    ],
  ] as const)('is %s on the foreign key columns', (_label, attribute, authorId, index) => {
    const fromPsl = buildFromPsl({ psl: { authorId: ` ${attribute}` }, ts: {} });
    expect(fromPsl).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming(index)] });
    expect(buildFromTs({ psl: {}, ts: { authorId } })).toEqual(fromPsl);
  });

  it.each([
    ['an unnamed primary key', '@id', 'id', { primaryKey: true }],
    ['a named primary key', '@id(map: "post_pkey")', 'namedId', { primaryKey: true }],
  ] as const)('is %s on the foreign key columns', (_label, attribute, authorId, index) => {
    const fromPsl = buildFromPsl({ psl: { authorId: ` ${attribute}` }, ts: {} });
    expect(fromPsl).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming(index)] });
    expect(buildFromTs({ psl: {}, ts: { authorId } })).toEqual(fromPsl);
  });

  it('is absent for index: false', () => {
    expectBothBuilds({
      psl: { relation: ', index: false' },
      ts: { foreignKey: { index: false } },
    }).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming(undefined)] });
  });

  it('is the partial index the relation names', () => {
    expectBothBuilds({
      psl: {
        relation: ', index: "post_author_live"',
        model: '@@index([authorId], where: sql`id > 0`, name: "post_author_live")',
      },
      ts: { foreignKey: { index: 'post_author_live' }, indexes: ['partial'] },
    }).toEqual({
      indexes: [partialIndex],
      foreignKeys: [foreignKeyNaming({ name: partialIndex.name })],
    });
  });

  it('keeps two identical named indexes and warns about them', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const fromPsl = buildFromPsl({
        psl: {
          model:
            '@@index([authorId], map: "post_author_by_hand")\n  @@index([authorId], name: "post_author")',
        },
        ts: {},
      });
      expect(buildFromTs({ psl: {}, ts: { indexes: ['namedTwice'] } })).toEqual(fromPsl);
      expect(fromPsl).toEqual({
        indexes: [
          { name: 'post_author_by_hand', columns: ['authorId'], unique: false },
          namedIndex,
        ],
        foreignKeys: [foreignKeyNaming({ name: 'post_author_by_hand' })],
      });
      expect(emitWarning.mock.calls).toEqual([
        [
          'Indexes "post_author_by_hand" and "post_author" on table "post" are identical: the planner sees them as the same index. The contract keeps both because each is named. Remove one of them.',
          { code: 'PN_INDEX_DUPLICATE' },
        ],
        [
          'Indexes "post_author_by_hand" and "post_author" on table "post" are identical: the planner sees them as the same index. The contract keeps both because each is named. Remove one of them.',
          { code: 'PN_INDEX_DUPLICATE' },
        ],
      ]);
    } finally {
      emitWarning.mockRestore();
    }
  });
});
