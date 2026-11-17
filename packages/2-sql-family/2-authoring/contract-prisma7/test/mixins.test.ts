import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { postgresSourceContext } from './support';

describe('a Prisma 7 schema that uses a mixin', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('is rejected at the mixin declaration and at the inclusion', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'prisma7-mixin-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      [
        'datasource db {',
        '  provider = "postgresql"',
        '}',
        '',
        'model mixin Timestamps {',
        '  createdAt DateTime @default(now())',
        '}',
        '',
        'model User {',
        '  id Int @id',
        '  +Timestamps',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );

    const result = await prisma7Contract(schemaPath, {
      binding: prisma7PostgresBinding,
    }).source.load(postgresSourceContext([schemaPath]));

    expect(
      (result.ok ? [] : result.failure.diagnostics).map(({ code, message, span }) => ({
        code,
        message,
        line: span?.start.line,
        column: span?.start.column,
      })),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: 'Unsupported top-level block "model mixin"',
        line: 5,
        column: 1,
      },
      {
        code: 'PSL_INVALID_MODEL_MEMBER',
        message: 'Unsupported mixin inclusion "+Timestamps"',
        line: 11,
        column: 3,
      },
    ]);
  });
});
