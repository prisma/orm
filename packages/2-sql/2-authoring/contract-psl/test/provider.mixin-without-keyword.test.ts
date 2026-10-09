import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import { createPostgresTestContext, postgresTarget } from './fixtures';

describe('prismaContract given a mixin written without its block keyword', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  async function diagnosticsOf(schema: string) {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-mixin-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, `// use prisma-8\n${schema}`, 'utf-8');
    const result = await prismaContract('./schema.prisma', {
      target: postgresTarget,
      createNamespace: createTestSqlNamespace,
    }).source.load({ ...createPostgresTestContext(), resolvedInputs: [schemaPath] });
    return (result.ok ? [] : result.failure.diagnostics).map(({ code, message, span }) => ({
      code,
      message,
      line: span?.start.line,
    }));
  }

  it('reports the declaration once and the inclusion that names it as not found', async () => {
    expect(
      await diagnosticsOf(
        [
          'mixin Timestamps {',
          '  createdAt DateTime',
          '}',
          '',
          'model User {',
          '  id Int @id',
          '  +Timestamps',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      {
        code: 'PSL_INVALID_DECLARATION',
        message:
          'A mixin starts with the keyword of the block it is for, for example "model mixin Timestamps"',
        line: 2,
      },
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find mixin "Timestamps"', line: 8 },
    ]);
  });

  it('reports the declaration once in a namespace, with nothing more for its body', async () => {
    expect(
      await diagnosticsOf(
        [
          'namespace app {',
          '  mixin Timestamps {',
          '    createdAt DateTime @default(now())',
          '    @@index([createdAt])',
          '  }',
          '  model User {',
          '    id Int @id',
          '  }',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      {
        code: 'PSL_INVALID_DECLARATION',
        message:
          'A mixin starts with the keyword of the block it is for, for example "model mixin Timestamps"',
        line: 3,
      },
    ]);
  });
});
