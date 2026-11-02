import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { loadPrisma6Schema, serializeMongoContract } from './support';

const casesDir = join(dirname(fileURLToPath(import.meta.url)), 'builder-cases');

describe('the Prisma 6 reader on the contract builder', () => {
  function indexesOf(serialized: unknown, collection: string): unknown {
    return (
      serialized as {
        storage: {
          namespaces: {
            __unbound__: { entries: { collection: Record<string, { indexes?: unknown }> } };
          };
        };
      }
    ).storage.namespaces.__unbound__.entries.collection[collection]?.indexes;
  }

  async function diagnosticsOf(caseName: string) {
    const result = await loadPrisma6Schema(join(casesDir, caseName, 'schema.prisma'));
    if (result.ok) throw new Error('Expected the schema to be refused');
    return result.failure.diagnostics.map(({ code, message, span }) => ({
      code,
      message,
      line: span?.start.line,
    }));
  }

  it.each<[string, string, string, readonly unknown[]]>([
    [
      'the same fields in another order or with another sort',
      'same-fields-other-order',
      'User',
      [
        { kind: 'mongo-index', keys: [{ field: 'email', direction: -1 }], unique: true },
        {
          kind: 'mongo-index',
          keys: [
            { field: 'email', direction: 1 },
            { field: 'name', direction: 1 },
          ],
        },
        {
          kind: 'mongo-index',
          keys: [
            { field: 'name', direction: 1 },
            { field: 'email', direction: 1 },
          ],
        },
        { kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }] },
      ],
    ],
    [
      '@unique and @@index with sort: Asc on one field, which Prisma 6 tells apart',
      'unique-and-index-sort-asc',
      'User',
      [
        { kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }], unique: true },
        { kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }] },
      ],
    ],
    [
      "@unique on a later model and @@index on an earlier model's field in one collection",
      'unique-on-later-model',
      'people',
      [
        { kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }] },
        { kind: 'mongo-index', keys: [{ field: 'name', direction: 1 }] },
        { kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }], unique: true },
      ],
    ],
  ])('keeps every index for %s', async (_, caseName, collection, indexes) => {
    const result = await loadPrisma6Schema(join(casesDir, caseName, 'schema.prisma'));
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));

    expect(indexesOf(serializeMongoContract(result.value), collection)).toEqual(indexes);
  });

  it.each<[string, string, readonly [readonly [number, string], readonly [number, string]]]>([
    [
      '@unique and @@unique on one field',
      'unique-twice',
      [
        [8, '@unique on field "User.email"'],
        [10, '@@unique([email]) on model "User"'],
      ],
    ],
    [
      '@unique and @@index on one field',
      'unique-and-index',
      [
        [8, '@unique on field "User.email"'],
        [10, '@@index([email]) on model "User"'],
      ],
    ],
    [
      '@@index and @@fulltext on one field',
      'fulltext-and-index',
      [
        [10, '@@index([title]) on model "Post"'],
        [11, '@@fulltext([title]) on model "Post"'],
      ],
    ],
  ])(
    'refuses %s at both indexes, naming the other, as Prisma 6 does',
    async (_, caseName, [first, second]) => {
      const message = (index: string, other: string) =>
        `${index} has the same fields, with the same sort, as ${other}. Prisma 6 refuses this: "Index already exists in the model." Remove one of them.`;
      expect(await diagnosticsOf(caseName)).toEqual([
        {
          code: 'PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS',
          message: message(first[1], second[1]),
          line: first[0],
        },
        {
          code: 'PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS',
          message: message(second[1], first[1]),
          line: second[0],
        },
      ]);
    },
  );

  it('refuses @unique(sort: Asc) beside @@unique on one field, which MongoDB holds as one index, showing the written sort', async () => {
    expect(await diagnosticsOf('unique-sort-asc-and-unique')).toEqual([
      {
        code: 'PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS',
        message:
          '@@unique([email]) on model "User" and @unique(sort: Asc) on field "User.email" are the same index, with the same keys and options, in collection "User". MongoDB cannot hold two identical indexes in one collection. Remove one of them.',
        line: 10,
      },
    ]);
  });

  it('refuses the same @@index on two models in one collection, naming both', async () => {
    expect(await diagnosticsOf('index-on-two-models')).toEqual([
      {
        code: 'PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS',
        message:
          '@@index([email]) on model "Admin" and @@index([email]) on model "User" are the same index, with the same keys and options, in collection "people". MongoDB cannot hold two identical indexes in one collection. Remove one of them.',
        line: 18,
      },
    ]);
  });

  it('refuses @@fulltext on one field of two models in one collection', async () => {
    expect(await diagnosticsOf('fulltext-on-two-models')).toEqual([
      {
        code: 'PSL.PRISMA6_MONGO_TEXT_INDEX_LIMIT',
        message:
          'Model "Admin" has a @@fulltext, but another model stored in the same collection has one too; MongoDB allows one text index per collection. Merge the fields into one @@fulltext.',
        line: 18,
      },
    ]);
  });

  it('reports a builder refusal where the schema writes its subject', async () => {
    const result = await loadPrisma6Schema(join(casesDir, 'generated-conflict', 'schema.prisma'));
    if (result.ok) throw new Error('Expected the schema to be refused');

    expect(
      result.failure.diagnostics.map(({ code, message, span }) => ({
        code,
        message,
        line: span?.start.line,
      })),
    ).toEqual([
      {
        code: 'PSL.PRISMA6_MONGO_GENERATED_VALUE_CONFLICT',
        message:
          'Field "Admin.touchedAt" generates its value differently from "User.touchedAt", which is stored in the same field "touchedAt" of collection "people". Give both fields the same @default(now()) or @updatedAt.',
        line: 15,
      },
    ]);
  });

  it('reports a relation on a refused field once, at the field', async () => {
    const result = await loadPrisma6Schema(
      join(casesDir, 'relation-on-rejected-field', 'schema.prisma'),
    );
    if (result.ok) throw new Error('Expected the schema to be refused');

    expect(
      result.failure.diagnostics.map(({ code, span }) => ({ code, line: span?.start.line })),
    ).toEqual([
      { code: 'PSL.PRISMA6_MONGO_UPDATED_AT_TYPE_UNSUPPORTED', line: 7 },
      { code: 'PSL.PRISMA6_MONGO_UPDATED_AT_TYPE_UNSUPPORTED', line: 14 },
    ]);
  });
});
