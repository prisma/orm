import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import { createPostgresTestContext, postgresTarget } from './fixtures';

const DIRECTIVE = '// use prisma-8\n';

const baseOptions = {
  target: postgresTarget,
  createNamespace: createTestSqlNamespace,
} as const;

describe('prismaContract membership set', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  async function createFixtureDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'psl-provider-membership-'));
    tempDirs.push(dir);
    return dir;
  }

  async function writeMultiFileFixture(dir: string): Promise<{
    readonly user: string;
    readonly post: string;
    readonly extra: string;
    readonly excluded: string;
  }> {
    const user = join(dir, 'user.prisma');
    const post = join(dir, 'post.prisma');
    const extra = join(dir, 'extra-namespace.prisma');
    const excluded = join(dir, 'draft.prisma');
    await writeFile(
      user,
      `${DIRECTIVE}model User {
  id Int @id
  posts Post[]
}

namespace billing {
  model Account {
    id Int @id
  }
}
`,
      'utf-8',
    );
    await writeFile(
      post,
      `${DIRECTIVE}model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`,
      'utf-8',
    );
    await writeFile(
      extra,
      `${DIRECTIVE}namespace billing {
  model Invoice {
    id Int @id
  }
}
`,
      'utf-8',
    );
    await writeFile(excluded, 'model Draft {\n  id Int @id\n}\n', 'utf-8');
    return { user, post, extra, excluded };
  }

  it('emits one contract from every member: cross-file relation and a namespace reopened across files both resolve', async () => {
    const dir = await createFixtureDir();
    const { user, post, extra } = await writeMultiFileFixture(dir);

    const contract = prismaContract(join(dir, 'schema.prisma'), baseOptions);
    const result = await contract.source.load(
      createPostgresTestContext({ resolvedInputs: [user, post, extra] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const publicModels = result.value.domain.namespaces['public']?.models ?? {};
    expect(Object.keys(publicModels).sort()).toEqual(['Post', 'User']);
    expect(
      (publicModels['Post'] as { relations?: Record<string, unknown> }).relations,
    ).toMatchObject({
      author: { cardinality: 'N:1' },
    });
    expect(Object.keys(result.value.domain.namespaces['billing']?.models ?? {}).sort()).toEqual([
      'Account',
      'Invoice',
    ]);
  });

  it('excludes a matched file without the directive from the emitted contract', async () => {
    const dir = await createFixtureDir();
    const { user, post, extra, excluded } = await writeMultiFileFixture(dir);

    const contract = prismaContract(join(dir, 'schema.prisma'), baseOptions);
    const result = await contract.source.load(
      createPostgresTestContext({ resolvedInputs: [user, post, extra, excluded] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.namespaces['public']?.models).not.toHaveProperty('Draft');
  });

  it('emits a byte-identical contract regardless of resolvedInputs order', async () => {
    const dir = await createFixtureDir();
    const { user, post, extra } = await writeMultiFileFixture(dir);
    const contract = prismaContract(join(dir, 'schema.prisma'), baseOptions);

    const orderings = [
      [user, post, extra],
      [extra, post, user],
      [post, extra, user],
    ];
    const results = await Promise.all(
      orderings.map((resolvedInputs) =>
        contract.source.load(createPostgresTestContext({ resolvedInputs })),
      ),
    );

    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const [first, ...rest] = results;
    if (!first?.ok) return;
    const baseline = JSON.stringify(first.value);
    for (const result of rest) {
      if (!result.ok) return;
      expect(JSON.stringify(result.value)).toBe(baseline);
    }
  });

  it('errors naming the configured pattern when nothing matched', async () => {
    const contract = prismaContract('./prisma/**/*.prisma', baseOptions);
    const result = await contract.source.load(createPostgresTestContext({ resolvedInputs: [] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_NO_SCHEMA_FILES_MATCHED',
          message: expect.stringContaining('./prisma/**/*.prisma'),
        }),
      ]),
    );
  });

  it('errors listing the candidates when none carries the directive', async () => {
    const dir = await createFixtureDir();
    const a = join(dir, 'a.prisma');
    const b = join(dir, 'b.prisma');
    await writeFile(a, 'model A {\n  id Int @id\n}\n', 'utf-8');
    await writeFile(b, 'model B {\n  id Int @id\n}\n', 'utf-8');

    const contract = prismaContract(join(dir, 'schema.prisma'), baseOptions);
    const result = await contract.source.load(
      createPostgresTestContext({ resolvedInputs: [a, b] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_NO_OPTED_IN_SCHEMA_FILES',
          message: expect.stringContaining(a),
        }),
      ]),
    );
  });

  it('keeps collecting after one member fails to read, reporting PSL_SCHEMA_READ_FAILED for it', async () => {
    const dir = await createFixtureDir();
    const { user, post } = await writeMultiFileFixture(dir);
    const missing = join(dir, 'missing.prisma');

    const contract = prismaContract(join(dir, 'schema.prisma'), baseOptions);
    const result = await contract.source.load(
      createPostgresTestContext({ resolvedInputs: [user, post, missing] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_SCHEMA_READ_FAILED',
          sourceId: missing,
        }),
      ]),
    );
  });
});
