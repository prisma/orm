import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { loadPrisma6Schema, serializeMongoContract } from './support';

const casesDir = join(dirname(fileURLToPath(import.meta.url)), 'builder-cases');

describe('the Prisma 6 reader on the contract builder', () => {
  it.each<[string, string, string, readonly unknown[]]>([
    [
      '@unique and @@unique on one field',
      'unique-twice',
      'User',
      [{ kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }], unique: true }],
    ],
    [
      '@unique and @@index on one field',
      'unique-and-index',
      'User',
      [{ kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }], unique: true }],
    ],
    [
      '@@fulltext on one field of two models in one collection',
      'fulltext-on-two-models',
      'people',
      [{ kind: 'mongo-index', keys: [{ field: 'name', direction: 'text' }] }],
    ],
    [
      "@unique on a later model and @@index on an earlier model's field in one collection",
      'unique-on-later-model',
      'people',
      [
        { kind: 'mongo-index', keys: [{ field: 'name', direction: 1 }] },
        { kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }], unique: true },
      ],
    ],
  ])('merges an identical or redundant index for %s', async (_, caseName, collection, indexes) => {
    const result = await loadPrisma6Schema(join(casesDir, caseName, 'schema.prisma'));
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const serialized = serializeMongoContract(result.value) as {
      storage: {
        namespaces: {
          __unbound__: { entries: { collection: Record<string, { indexes?: unknown }> } };
        };
      };
    };

    expect(
      serialized.storage.namespaces.__unbound__.entries.collection[collection]?.indexes,
    ).toEqual(indexes);
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
