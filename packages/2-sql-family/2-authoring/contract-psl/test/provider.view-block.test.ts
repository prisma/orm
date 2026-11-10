import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import { createPostgresTestContext, postgresTarget } from './fixtures';

describe('prismaContract given a view block', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('reports each attributed field line as an invalid entry, then the view as an unsupported block', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-view-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `// use prisma-8
view ActiveUsers {
  id    Int    @unique
  email String
}

model User {
  id Int @id
}
`,
      'utf-8',
    );

    const result = await prismaContract('./schema.prisma', {
      target: postgresTarget,
      createNamespace: createTestSqlNamespace,
    }).source.load({ ...createPostgresTestContext(), resolvedInputs: [schemaPath] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      summary: 'Schema has 2 errors',
      diagnostics: [
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          message: 'Invalid block entry',
          sourceId: schemaPath,
          span: {
            start: { offset: 50, line: 3, column: 16 },
            end: { offset: 51, line: 3, column: 17 },
          },
        },
        {
          code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
          message: 'Unsupported top-level block "view"',
          sourceId: schemaPath,
          span: {
            start: { offset: 16, line: 2, column: 1 },
            end: { offset: 20, line: 2, column: 5 },
          },
        },
      ],
    });
  });
});
