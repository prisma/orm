import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { postgresSourceContext } from './support';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function loadModels(models: string) {
  dir = await mkdtemp(join(tmpdir(), 'prisma7-constraint-name-length-'));
  const schemaPath = join(dir, 'schema.prisma');
  await writeFile(schemaPath, `datasource db {\n  provider = "postgresql"\n}\n\n${models}`);
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    postgresSourceContext([schemaPath]),
  );
}

const tooLong = 'n'.repeat(64);
const longest = 'n'.repeat(63);

const cases = [
  {
    attribute: '@@index',
    owner: 'Model "A"',
    models: (map: string) =>
      `model A {\n  id Int @id\n  x  Int\n  @@index([x], map: "${map}")\n}\n`,
  },
  {
    attribute: '@@unique',
    owner: 'Model "A"',
    models: (map: string) =>
      `model A {\n  id Int @id\n  x  Int\n  @@unique([x], map: "${map}")\n}\n`,
  },
  {
    attribute: '@unique',
    owner: 'Field "A.x"',
    models: (map: string) => `model A {\n  id Int @id\n  x  Int @unique(map: "${map}")\n}\n`,
  },
  {
    attribute: '@id',
    owner: 'Field "A.id"',
    models: (map: string) => `model A {\n  id Int @id(map: "${map}")\n}\n`,
  },
  {
    attribute: '@@id',
    owner: 'Model "A"',
    models: (map: string) => `model A {\n  a Int\n  b Int\n  @@id([a, b], map: "${map}")\n}\n`,
  },
  {
    attribute: '@relation',
    owner: 'Field "B.a"',
    models: (map: string) =>
      `model A {\n  id Int @id\n  bs B[]\n}\n\nmodel B {\n  id  Int @id\n  aId Int\n  a   A   @relation(fields: [aId], references: [id], map: "${map}")\n}\n`,
  },
];

describe('a constraint name stated with map', () => {
  it.each(cases)(
    'refuses a 64-byte map on $attribute, as Prisma 7 does',
    async ({ attribute, owner, models }) => {
      const result = await loadModels(models(tooLong));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.filter(
          (diagnostic) => diagnostic.code === 'PSL.PRISMA7_CONSTRAINT_NAME_TOO_LONG',
        ),
      ).toEqual([
        expect.objectContaining({
          message: `${owner}: the name "${tooLong}" in the map argument of ${attribute} is 64 bytes, longer than the 63 bytes the database keeps. Shorten the map to 63 bytes or fewer; Prisma 7 refuses this name too.`,
        }),
      ]);
    },
  );

  it.each(cases)('accepts a 63-byte map on $attribute', async ({ models }) => {
    const result = await loadModels(models(longest));

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
  });

  it('counts bytes, not characters', async () => {
    const multibyte = 'ü'.repeat(32);
    const result = await loadModels(
      `model A {\n  id Int @id\n  x  Int\n  @@index([x], map: "${multibyte}")\n}\n`,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL.PRISMA7_CONSTRAINT_NAME_TOO_LONG',
        message: `Model "A": the name "${multibyte}" in the map argument of @@index is 64 bytes, longer than the 63 bytes the database keeps. Shorten the map to 63 bytes or fewer; Prisma 7 refuses this name too.`,
      }),
    ]);
  });
});
