import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Schema } from '../src/provider';
import { postgresPrisma7Options, postgresSourceContext } from './support';

function scratchDir(name: string): string {
  const dir = join(tmpdir(), `prisma7-provider-${name}-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('prisma7Schema', () => {
  it('declares the prisma7 format and the input path', () => {
    expect(prisma7Schema('prisma/schema.prisma', postgresPrisma7Options)).toMatchObject({
      source: { format: 'prisma7', inputs: ['prisma/schema.prisma'] },
    });
  });

  it('writes contract.json beside the schema file or directory, whatever either is named', () => {
    const outputOf = (path: string) => prisma7Schema(path, postgresPrisma7Options).output;
    expect(outputOf('prisma/schema.prisma')).toBe('prisma/contract.json');
    expect(outputOf('prisma/schema-single.prisma')).toBe('prisma/contract.json');
    expect(outputOf('prisma/schema')).toBe('prisma/contract.json');
    expect(outputOf('prisma/models/')).toBe('prisma/contract.json');
    expect(outputOf('schema.prisma')).toBe('contract.json');
  });

  it('lets options.output override the default', () => {
    expect(
      prisma7Schema('prisma/schema.prisma', { ...postgresPrisma7Options, output: 'out/c.json' })
        .output,
    ).toBe('out/c.json');
  });

  it('reads every .prisma file under a directory input, nested directories included, sorted by path', async () => {
    const dir = scratchDir('directory');
    writeFileSync(
      join(dir, 'b-models.prisma'),
      'model Post {\n  id Int\n  title String @map("post_title")\n}\n',
    );
    writeFileSync(
      join(dir, 'a-datasource.prisma'),
      'datasource db {\n  provider = "postgresql"\n}\n',
    );
    writeFileSync(join(dir, 'notes.txt'), 'model Ignored {\n  id Int\n}\n');
    mkdirSync(join(dir, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'nested', 'c.prisma'), 'model Nested {\n  id Int\n}\n');
    writeFileSync(join(dir, 'nested', 'deep', 'd.prisma'), 'model Deep {\n  id Int\n}\n');
    writeFileSync(join(dir, 'nested', 'deep', 'readme.md'), 'model NotPrisma {\n  id Int\n}\n');

    const config = prisma7Schema('prisma/schema', postgresPrisma7Options);
    const result = await config.source.load(postgresSourceContext([dir]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.domain.namespaces['public']?.models ?? {}).sort()).toEqual([
      'Deep',
      'Nested',
      'Post',
    ]);
  });

  it('names a nested file by its path under the directory in diagnostics', async () => {
    const dir = scratchDir('nested-diagnostic');
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n}\n');
    mkdirSync(join(dir, 'models'));
    writeFileSync(join(dir, 'models', 'broken.prisma'), 'model Broken {\n  id Int\n');

    const config = prisma7Schema('prisma/schema', postgresPrisma7Options);
    const result = await config.source.load(postgresSourceContext([dir]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'PSL_UNTERMINATED_BLOCK',
        sourceId: 'prisma/schema/models/broken.prisma',
      }),
    );
  });

  it('reports a diagnostic with the file id when a file in the directory is malformed', async () => {
    const dir = scratchDir('malformed');
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n}\n');
    writeFileSync(join(dir, 'broken.prisma'), 'model Broken {\n  id Int\n');

    const config = prisma7Schema('prisma/schema', postgresPrisma7Options);
    const result = await config.source.load(postgresSourceContext([dir]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'PSL_UNTERMINATED_BLOCK',
        sourceId: 'prisma/schema/broken.prisma',
      }),
    );
  });

  it('skips a directory whose name ends in .prisma, as Prisma 7 does', async () => {
    const dir = scratchDir('dot-prisma-directory');
    writeFileSync(
      join(dir, 'schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n}\n\nmodel A {\n  id Int @id\n}\n',
    );
    mkdirSync(join(dir, 'extra.prisma'));

    const config = prisma7Schema('prisma/schema', postgresPrisma7Options);
    const result = await config.source.load(postgresSourceContext([dir]));
    expect(result.ok).toBe(true);
  });

  it('reads .prisma files and directories reached through symbolic links', async () => {
    const shared = scratchDir('symlink-target');
    mkdirSync(join(shared, 'models'));
    writeFileSync(join(shared, 'b.prisma'), 'model B {\n  id Int @id\n}\n');
    writeFileSync(join(shared, 'models', 'c.prisma'), 'model C {\n  id Int @id\n}\n');
    const dir = scratchDir('symlinks');
    writeFileSync(
      join(dir, 'schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n}\n\nmodel A {\n  id Int @id\n}\n',
    );
    symlinkSync(join(shared, 'b.prisma'), join(dir, 'b.prisma'));
    symlinkSync(join(shared, 'models'), join(dir, 'linked'));

    const config = prisma7Schema('prisma/schema', postgresPrisma7Options);
    const result = await config.source.load(postgresSourceContext([dir]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.domain.namespaces['public']?.models ?? {}).sort()).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('returns PRISMA7_SCHEMA_READ_FAILED at the input path when a directory holds no .prisma file', async () => {
    const dir = scratchDir('empty');
    writeFileSync(join(dir, 'notes.txt'), 'not a schema\n');

    const config = prisma7Schema('prisma/schema', postgresPrisma7Options);
    const result = await config.source.load(postgresSourceContext([dir]));
    expect(result).toMatchObject({
      ok: false,
      failure: {
        diagnostics: [
          {
            code: 'PRISMA7_SCHEMA_READ_FAILED',
            sourceId: 'prisma/schema',
            message: 'The schema directory "prisma/schema" contains no .prisma file.',
          },
        ],
      },
    });
  });

  it('returns PRISMA7_SCHEMA_READ_FAILED when the input does not exist', async () => {
    const config = prisma7Schema('prisma/missing.prisma', postgresPrisma7Options);
    const result = await config.source.load(
      postgresSourceContext([join(scratchDir('missing'), 'missing.prisma')]),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: {
        summary: 'Failed to read Prisma 7 schema at "prisma/missing.prisma"',
        diagnostics: [expect.objectContaining({ code: 'PRISMA7_SCHEMA_READ_FAILED' })],
      },
    });
  });
});
