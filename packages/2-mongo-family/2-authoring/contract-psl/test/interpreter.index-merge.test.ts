import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const lookups = {
  scalarTypes: new Map([
    ['String', 'mongo/string@1'],
    ['ObjectId', 'mongo/objectId@1'],
  ]),
  defaultFunctionRegistry: new Map(),
  codecLookup: mongoCodecLookup,
  dataTypes: mongoDataTypeSupport,
} as const;

function indexesOf(schema: string, collection = 'users'): unknown {
  const result = interpretMongoContract(schema, lookups);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return JSON.parse(JSON.stringify(result.value.storage)).namespaces.__unbound__.entries.collection[
    collection
  ].indexes;
}

const a = [{ field: 'a', direction: 1 }];
const ab = [
  { field: 'a', direction: 1 },
  { field: 'b', direction: 1 },
];

describe('PSL indexes identical to, or redundant beside, another index in the collection', () => {
  it('becomes one unique index for @unique and @@index on one field', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String   @unique
  @@index([a])
  @@map("users")
}
`),
    ).toEqual([{ kind: 'mongo-index', name: 'a_1', keys: a, unique: true }]);
  });

  it('becomes one unique index for @@unique and @@index on the same fields', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  b  String
  @@index([a, b])
  @@unique([a, b])
  @@map("users")
}
`),
    ).toEqual([{ kind: 'mongo-index', name: 'a_1_b_1', keys: ab, unique: true }]);
  });

  it('stays two indexes for the same fields in another order', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  b  String
  @@index([a, b])
  @@index([b, a])
  @@map("users")
}
`),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1_b_1', keys: ab },
      { kind: 'mongo-index', name: 'b_1_a_1', keys: [ab[1], ab[0]] },
    ]);
  });

  it("becomes the later model's unique index, at its position, for a plain index on an earlier model", () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  b  String
  @@index([a])
  @@index([b])
  @@map("users")
}

model Admin {
  id ObjectId @id @map("_id")
  a  String   @unique
  @@map("users")
}
`),
    ).toEqual([
      { kind: 'mongo-index', name: 'b_1', keys: [{ field: 'b', direction: 1 }] },
      { kind: 'mongo-index', name: 'a_1', keys: a, unique: true },
    ]);
  });

  it('becomes one index for an index its model declares twice', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String   @unique
  @@unique([a])
  @@map("users")
}
`),
    ).toEqual([{ kind: 'mongo-index', name: 'a_1', keys: a, unique: true }]);
  });

  it('becomes one index for an index two models in the collection declare', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  @@index([a])
  @@map("users")
}

model Admin {
  id ObjectId @id @map("_id")
  a  String
  @@index([a])
  @@map("users")
}
`),
    ).toEqual([{ kind: 'mongo-index', name: 'a_1', keys: a }]);
  });

  it('becomes one text index for a text index two models in the collection declare', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  @@textIndex([a])
  @@map("users")
}

model Admin {
  id ObjectId @id @map("_id")
  a  String
  @@textIndex([a])
  @@map("users")
}
`),
    ).toEqual([{ kind: 'mongo-index', name: 'a_text', keys: [{ field: 'a', direction: 'text' }] }]);
  });

  it('becomes one index for an index with sparse set to false beside one without options', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  @@index([a])
  @@index([a], sparse: false)
  @@map("users")
}
`),
    ).toEqual([{ kind: 'mongo-index', name: 'a_1', keys: a }]);
  });

  it('stays two indexes on the same field with another collation or filter, each named', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  @@index([a])
  @@index([a], collationLocale: "fr", map: "a_fr")
  @@index([a], filter: "{\\"a\\": \\"x\\"}", map: "a_x")
  @@map("users")
}
`),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1', keys: a },
      { kind: 'mongo-index', name: 'a_fr', keys: a, collation: { locale: 'fr' } },
      { kind: 'mongo-index', name: 'a_x', keys: a, partialFilterExpression: { a: 'x' } },
    ]);
  });

  it('stays two indexes for a unique and a plain index that map gives other names', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String   @unique(map: "User_a_key")
  @@index([a], map: "User_a_idx")
  @@map("users")
}
`),
    ).toEqual([
      { kind: 'mongo-index', name: 'User_a_key', keys: a, unique: true },
      { kind: 'mongo-index', name: 'User_a_idx', keys: a },
    ]);
  });

  it('stays one index for each variant that indexes the same field under its own map', () => {
    expect(
      indexesOf(`model Task {
  id   ObjectId @id @map("_id")
  type String
  @@discriminator(type)
  @@map("users")
}

model Bug {
  a String
  @@base(Task, "bug")
  @@index([a], map: "bug_a")
}

model Feature {
  a String
  @@base(Task, "feature")
  @@index([a], map: "feature_a")
}
`),
    ).toEqual([
      { kind: 'mongo-index', name: 'bug_a', keys: a, partialFilterExpression: { type: 'bug' } },
      {
        kind: 'mongo-index',
        name: 'feature_a',
        keys: a,
        partialFilterExpression: { type: 'feature' },
      },
    ]);
  });

  it.each([
    [
      'two variants that index the same field without map',
      `model Task {
  id   ObjectId @id @map("_id")
  type String
  @@discriminator(type)
  @@map("users")
}

model Bug {
  a String
  @@base(Task, "bug")
  @@index([a])
}

model Feature {
  a String
  @@base(Task, "feature")
  @@index([a])
}
`,
      {
        line: 17,
        message:
          '@@index([a]) on model "Feature" is named "a_1", as is @@index([a]) on model "Bug", in collection "users". An index without `map` is named after its keys and directions. Give one of them another name with `map`.',
      },
    ],
    [
      'two indexes that map gives one name',
      `model User {
  id ObjectId @id @map("_id")
  a  String
  b  String
  @@index([a], map: "by")
  @@index([b], map: "by")
  @@map("users")
}
`,
      {
        line: 6,
        message:
          '@@index([b], map: "by") on model "User" is named "by", as is @@index([a], map: "by") on model "User", in collection "users". An index without `map` is named after its keys and directions. Give one of them another name with `map`.',
      },
    ],
    [
      'two identical indexes with different names',
      `model User {
  id ObjectId @id @map("_id")
  a  String   @unique
  @@unique([a], map: "User_a_key")
  @@map("users")
}
`,
      {
        line: 4,
        message:
          '@@unique([a], map: "User_a_key") on model "User" has the same keys and options as @unique on field "User.a", in collection "users", but another name. MongoDB cannot hold both. Remove one of them, or give them the same `map`.',
      },
    ],
    [
      'an empty map',
      `model User {
  id ObjectId @id @map("_id")
  a  String   @unique(map: "")
  @@map("users")
}
`,
      { line: 3, message: 'The `map` argument of an index cannot be an empty string.' },
    ],
  ])('refuses %s at the index', (_, schema, expected) => {
    const result = interpretMongoContract(schema, lookups);
    if (result.ok) throw new Error('Expected the schema to be refused');

    expect(
      result.failure.diagnostics.map(({ code, span, message }) => ({
        code,
        line: span?.start.line,
        message,
      })),
    ).toEqual([{ code: 'PSL_INVALID_INDEX', ...expected }]);
  });

  it('reports a refused index after a merged one at the line that writes it', () => {
    const result = interpretMongoContract(
      `model User {
  id ObjectId @id @map("_id")
  a  String   @unique
  b  String
  c  String
  @@index([a])
  @@textIndex([b])
  @@textIndex([c])
  @@map("users")
}
`,
      lookups,
    );
    if (result.ok) throw new Error('Expected the schema to be refused');

    expect(
      result.failure.diagnostics.map(({ code, span }) => ({ code, line: span?.start.line })),
    ).toEqual([{ code: 'PSL_INVALID_INDEX', line: 8 }]);
  });
});
