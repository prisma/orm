import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATH =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md';

function detects(id: string, content: string): boolean {
  return detectionPatterns(GUIDE_PATH, id).some((pattern) => pattern.test(content));
}

describe.each([
  'typescript-contract-include-row-types',
  'typescript-contract-index-references',
  'typescript-contract-storage-and-domain-types',
])('%s detection', (id) => {
  it.each([
    [
      'a Postgres contract builder',
      "import { defineContract, rel } from '@prisma/orm-postgres/contract-builder';",
    ],
    [
      'a SQLite contract builder on several lines',
      "import {\n  defineContract,\n  field,\n} from '@prisma/orm-sqlite/contract-builder';",
    ],
  ])('finds %s', (_name, content) => {
    expect(detects(id, content)).toBe(true);
  });

  it.each([
    ['an include call', "const posts = await db.orm.public.Post.include('author').all();"],
    ['an index read', 'db.orm.public.Document.where((_doc, { fns, indexes }) => indexes.search)'],
    ['a whereUnique call', 'await db.orm.public.User.whereUnique({ id }).first();'],
    ['a field import only', "import { field } from '@prisma/orm-postgres/contract-builder';"],
    [
      'a Mongo contract builder',
      "import { defineContract } from '@prisma/orm-mongo/contract-builder';",
    ],
  ])('skips %s', (_name, content) => {
    expect(detects(id, content)).toBe(false);
  });
});

describe('typescript-contract-parameterized-output-types detection', () => {
  const id = 'typescript-contract-parameterized-output-types';

  it.each([
    ['a pgvector type constructor', 'types: { Embedding1536: type.pgvector.Vector(1536) },'],
    [
      'the pgvector column helper',
      "import { vector } from '@prisma/orm-extension-pgvector/column-types';\nconst embedding = field.column(vector(1536));",
    ],
  ])('finds %s', (_name, content) => {
    expect(detects(id, content)).toBe(true);
  });

  it.each([
    [
      'a vector type in SQL text',
      "await client.query('CREATE TABLE embedded (name text PRIMARY KEY, embedding vector(3))');",
    ],
    ['a vector type in a migration', "col('embedding', 'vector(1024)', {})"],
    ['a test helper named vector', 'expect(embeddings).toEqual([vector(1), vector(2)]);'],
  ])('skips %s', (_name, content) => {
    expect(detects(id, content)).toBe(false);
  });
});
