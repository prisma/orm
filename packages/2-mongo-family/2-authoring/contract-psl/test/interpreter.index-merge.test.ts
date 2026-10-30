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
    ).toEqual([{ kind: 'mongo-index', keys: a, unique: true }]);
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
    ).toEqual([{ kind: 'mongo-index', keys: ab, unique: true }]);
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
      { kind: 'mongo-index', keys: ab },
      { kind: 'mongo-index', keys: [ab[1], ab[0]] },
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
      { kind: 'mongo-index', keys: [{ field: 'b', direction: 1 }] },
      { kind: 'mongo-index', keys: a, unique: true },
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
    ).toEqual([{ kind: 'mongo-index', keys: a, unique: true }]);
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
    ).toEqual([{ kind: 'mongo-index', keys: a }]);
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
    ).toEqual([{ kind: 'mongo-index', keys: [{ field: 'a', direction: 'text' }] }]);
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
    ).toEqual([{ kind: 'mongo-index', keys: a }]);
  });

  it('stays two indexes on the same field with another collation or filter', () => {
    expect(
      indexesOf(`model User {
  id ObjectId @id @map("_id")
  a  String
  @@index([a])
  @@index([a], collationLocale: "fr")
  @@index([a], filter: "{\\"a\\": \\"x\\"}")
  @@map("users")
}
`),
    ).toEqual([
      { kind: 'mongo-index', keys: a },
      { kind: 'mongo-index', keys: a, collation: { locale: 'fr' } },
      { kind: 'mongo-index', keys: a, partialFilterExpression: { a: 'x' } },
    ]);
  });

  it('stays one index for each variant that indexes the same field', () => {
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
  @@index([a])
}

model Feature {
  a String
  @@base(Task, "feature")
  @@index([a])
}
`),
    ).toEqual([
      { kind: 'mongo-index', keys: a, partialFilterExpression: { type: 'bug' } },
      { kind: 'mongo-index', keys: a, partialFilterExpression: { type: 'feature' } },
    ]);
  });
});
