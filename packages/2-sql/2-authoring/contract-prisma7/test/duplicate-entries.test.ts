/**
 * Prisma 7's dialect reads its blocks structurally, so duplicate-key
 * reporting for those blocks belongs to this package — the parser collects
 * unregistered keywords as symbols without interpreting them, so no shared
 * pass sees their entries.
 */

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

async function loadSchema(schema: string) {
  dir = await mkdtemp(join(tmpdir(), 'prisma7-duplicates-'));
  const schemaPath = join(dir, 'schema.prisma');
  await writeFile(schemaPath, schema);
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    postgresSourceContext([schemaPath]),
  );
}

describe('prisma7-owned duplicate block entries', () => {
  it('reports a duplicate enum member name once, first occurrence wins', async () => {
    const result = await loadSchema(
      [
        'datasource db {',
        '  provider = "postgresql"',
        '}',
        '',
        'enum Role {',
        '  Admin',
        '  Admin',
        '  User',
        '}',
        '',
        'model A {',
        '  id   Int  @id',
        '  role Role',
        '}',
        '',
      ].join('\n'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const duplicates = result.failure.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'PSL_EXTENSION_DUPLICATE_PARAMETER',
    );
    expect(duplicates).toEqual([
      expect.objectContaining({
        message: 'Duplicate parameter "Admin" in "enum" block "Role"; first occurrence wins',
      }),
    ]);
  });

  it('reports a duplicate datasource property once, anchored on the later entry', async () => {
    const result = await loadSchema(
      [
        'datasource db {',
        '  provider = "postgresql"',
        '  provider = "mysql"',
        '}',
        '',
        'model A {',
        '  id Int @id',
        '}',
        '',
      ].join('\n'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const duplicates = result.failure.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'PSL_EXTENSION_DUPLICATE_PARAMETER',
    );
    expect(duplicates).toEqual([
      expect.objectContaining({
        message: 'Duplicate parameter "provider" in "datasource" block "db"; first occurrence wins',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
      }),
    ]);
  });

  it('reads the first datasource provider through the structural getter', async () => {
    const result = await loadSchema(
      [
        'datasource db {',
        '  provider = "postgresql"',
        '}',
        '',
        'model A {',
        '  id Int @id',
        '}',
        '',
      ].join('\n'),
    );

    expect(result.ok).toBe(true);
  });
});
