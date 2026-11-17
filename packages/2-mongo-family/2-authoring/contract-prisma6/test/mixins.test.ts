import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { prisma6MongoBinding } from '@internal/target-mongo/prisma6-binding';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma6Contract } from '../src/provider';
import { mongoSourceContext } from './support';

describe('a Prisma 6 schema that uses a mixin', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('is rejected at the mixin declaration and at the inclusion', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'prisma6-mixin-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      [
        'datasource db {',
        '  provider = "mongodb"',
        '}',
        '',
        'model mixin Timestamps {',
        '  createdAt DateTime @default(now())',
        '}',
        '',
        'model User {',
        '  id String @id @default(auto()) @map("_id") @db.ObjectId',
        '  +Timestamps',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );

    const result = await prisma6Contract(schemaPath, {
      binding: prisma6MongoBinding,
    }).source.load(mongoSourceContext([schemaPath]));

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
