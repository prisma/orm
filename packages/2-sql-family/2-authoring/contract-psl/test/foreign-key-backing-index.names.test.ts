import { describe, expect, it, vi } from 'vitest';
import {
  buildFromPsl,
  buildFromTs,
  type Case,
  expectBothBuilds,
  foreignKeyNaming,
  interpretPost,
  interpretSchema,
} from './foreign-key-backing-index.support';

const btreeIndex = {
  name: 'post_author_af133e1f',
  prefix: 'post_author',
  columns: ['authorId'],
  unique: false,
  type: 'btree',
  options: {},
};

const namedIndex = {
  name: 'post_author_e47547ed',
  prefix: 'post_author',
  columns: ['authorId'],
  unique: false,
};

function expectRefusedOnBothSurfaces(testCase: Case, message: string, fix: string) {
  const result = interpretPost(testCase);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.diagnostics).toEqual([
    expect.objectContaining({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: `${message} ${fix}`,
      sourceId: 'schema.prisma',
      span: expect.objectContaining({
        start: expect.objectContaining({ line: 10, column: 15 }),
      }),
    }),
  ]);
  expect(() => buildFromTs(testCase)).toThrow(message);
}

describe("a relation's backing index", () => {
  it('is an explicit btree index identical to the derived one', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId], type: "btree", options: {}, name: "post_author")' },
      ts: { indexes: ['btree'] },
    }).toEqual({
      indexes: [btreeIndex],
      foreignKeys: [foreignKeyNaming({ name: btreeIndex.name })],
    });
  });

  it('is the unique constraint the relation names', () => {
    expectBothBuilds({
      psl: { authorId: ' @unique(map: "post_author_key")', relation: ', index: "post_author_key"' },
      ts: { authorId: 'namedUnique', foreignKey: { index: 'post_author_key' } },
    }).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming({ unique: ['authorId'] })] });
  });

  it('is the primary key the relation names', () => {
    expectBothBuilds({
      psl: { authorId: ' @id(map: "post_pkey")', relation: ', index: "post_pkey"' },
      ts: { authorId: 'namedId', foreignKey: { index: 'post_pkey' } },
    }).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming({ primaryKey: true })] });
  });

  it('is a named index that duplicates a unique constraint, which the build warns about', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const testCase: Case = {
        psl: { authorId: ' @unique', model: '@@index([authorId], name: "post_author")' },
        ts: { authorId: 'unique', indexes: ['named'] },
      };
      const fromPsl = buildFromPsl(testCase);
      expect(buildFromTs(testCase)).toEqual(fromPsl);
      expect(fromPsl).toEqual({
        indexes: [namedIndex],
        foreignKeys: [foreignKeyNaming({ name: namedIndex.name })],
      });
      const warning = [
        'Index "post_author" on table "post" has the same columns as the unique constraint on (authorId), which already serves the same lookups. The contract keeps the index because it is named. Remove it.',
        { code: 'PN_INDEX_REDUNDANT' },
      ];
      expect(emitWarning.mock.calls).toEqual([warning, warning]);
    } finally {
      emitWarning.mockRestore();
    }
  });
});

describe("a relation's index argument", () => {
  const subject = (name: string) =>
    `The foreign key on table "post" columns (authorId) names "${name}" as its index`;

  it('is refused at the relation when it names nothing on the table', () => {
    expectRefusedOnBothSurfaces(
      {
        psl: { relation: ', index: "post_author_gone"' },
        ts: { foreignKey: { index: 'post_author_gone' } },
      },
      `${subject('post_author_gone')}, but table "post" has no index, unique constraint or primary key with that name.`,
      'Declare an index, unique constraint or primary key named "post_author_gone" on table "post", or drop the index argument so the foreign key gets its own backing index.',
    );
  });

  it('is refused at the relation when an index and a key share the name', () => {
    expectRefusedOnBothSurfaces(
      {
        psl: {
          authorId: ' @unique(map: "post_author_key")',
          relation: ', index: "post_author_key"',
          model: '@@index([authorId], where: sql`id > 0`, map: "post_author_key")',
        },
        ts: {
          authorId: 'namedUnique',
          indexes: ['partialNamedLikeKey'],
          foreignKey: { index: 'post_author_key' },
        },
      },
      `${subject('post_author_key')}, but table "post" has more than one index, unique constraint or primary key with that name.`,
      'Give the object the foreign key should use a name no other index, unique constraint or primary key of table "post" has, and name that on the relation.',
    );
  });

  it('is refused at the relation when the named index does not start with its columns', () => {
    expectRefusedOnBothSurfaces(
      {
        psl: { relation: ', index: "post_by_id"', model: '@@index([id], name: "post_by_id")' },
        ts: { indexes: ['byId'], foreignKey: { index: 'post_by_id' } },
      },
      `${subject('post_by_id')}, but its columns (id) do not start with the foreign key's columns, so it does not serve the foreign key's lookups.`,
      'Name an index, unique constraint or primary key whose first columns are (authorId), or drop the index argument so the foreign key gets its own backing index.',
    );
  });

  it('is reported at the relation it belongs to when two relations share the foreign key columns', () => {
    const result = interpretSchema(`model User {
  id Int @id
  posts Post[]
  @@map("user")
}

model Editor {
  id Int @id
  posts Post[]
  @@map("editor")
}

model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id], index: "post_author")
  editor Editor @relation(fields: [authorId], references: [id], index: "post_author_gone")
  @@index([authorId], name: "post_author")
  @@map("post")
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        span: expect.objectContaining({
          start: expect.objectContaining({ line: 17, column: 17 }),
        }),
      }),
    ]);
  });
});
