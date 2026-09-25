import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  erroredEnvelope,
  harness,
  mocks,
  ormConfig,
  PSL,
  projectDir,
  useContractPrintDoubles,
} from './contract-print-support';

useContractPrintDoubles();

describe('contract print output path', () => {
  it('refuses to write over the schema it reads and leaves that file untouched', async () => {
    const dir = await projectDir();
    const schema = 'model User {\n  id Int @id\n}\n';
    await mkdir(join(dir, 'prisma'), { recursive: true });
    await writeFile(join(dir, 'prisma', 'schema.prisma'), schema, 'utf-8');

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'prisma/schema.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.PRINT_OUTPUT_IS_SOURCE',
      meta: { output: 'prisma/schema.prisma', source: 'prisma/schema.prisma' },
    });
    expect(await readFile(join(dir, 'prisma', 'schema.prisma'), 'utf-8')).toBe(schema);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('leaves the source untouched when the output path differs from it only in case', async () => {
    const dir = await projectDir();
    const schema = 'model User {\n  id Int @id\n}\n';
    await mkdir(join(dir, 'prisma'), { recursive: true });
    await writeFile(join(dir, 'prisma', 'schema.prisma'), schema, 'utf-8');
    const volumeIgnoresCase = existsSync(join(dir, 'PRISMA', 'SCHEMA.PRISMA'));

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'prisma/Schema.prisma', '--json'],
      { cwd: dir },
    );

    expect(await readFile(join(dir, 'prisma', 'schema.prisma'), 'utf-8')).toBe(schema);
    if (volumeIgnoresCase) {
      expect(run.exitCode).toBe(2);
      expect(erroredEnvelope(run).error).toMatchObject({
        code: 'CONTRACT.PRINT_OUTPUT_IS_SOURCE',
        meta: { output: 'prisma/Schema.prisma', source: 'prisma/schema.prisma' },
      });
    } else {
      expect(run.exitCode).toBe(0);
      expect(await readFile(join(dir, 'prisma', 'Schema.prisma'), 'utf-8')).toBe(PSL);
    }
  });

  it('refuses an output path that reaches the source through a symbolic link', async () => {
    const dir = await projectDir();
    const schema = 'model User {\n  id Int @id\n}\n';
    await mkdir(join(dir, 'prisma'), { recursive: true });
    await writeFile(join(dir, 'prisma', 'schema.prisma'), schema, 'utf-8');
    await symlink(join(dir, 'prisma'), join(dir, 'linked'), 'dir');

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'linked/schema.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.PRINT_OUTPUT_IS_SOURCE',
      meta: { output: 'linked/schema.prisma', source: 'prisma/schema.prisma' },
    });
    expect(await readFile(join(dir, 'prisma', 'schema.prisma'), 'utf-8')).toBe(schema);
  });

  it('refuses to write over a file a glob input of the contract source matches', async () => {
    const dir = await projectDir();
    const schema = 'model User {\n  id Int @id\n}\n';
    await mkdir(join(dir, 'prisma', 'models'), { recursive: true });
    await writeFile(join(dir, 'prisma', 'models', 'user.prisma'), schema, 'utf-8');
    const config = ormConfig(dir, {
      contract: {
        source: { format: 'psl', inputs: ['./prisma/**/*.prisma'], load: mocks.load },
        output: join(dir, 'generated', 'contract.json'),
      },
    });

    const run = await harness(config).run(
      ['contract', 'print', '--output', 'prisma/models/user.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.PRINT_OUTPUT_IS_SOURCE',
      meta: { output: 'prisma/models/user.prisma', source: 'prisma/models/user.prisma' },
    });
    expect(await readFile(join(dir, 'prisma', 'models', 'user.prisma'), 'utf-8')).toBe(schema);
  });

  it('refuses to write over the config file', async () => {
    const dir = await projectDir();
    const configText = 'export default {};\n';
    await writeFile(join(dir, 'prisma.config.ts'), configText, 'utf-8');

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'print', '--output', 'prisma.config.ts', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({
      code: 'CONTRACT.PRINT_OUTPUT_IS_PROJECT_FILE',
      summary: 'contract print would write over the config file',
      meta: { output: 'prisma.config.ts', file: 'prisma.config.ts' },
    });
    expect(await readFile(join(dir, 'prisma.config.ts'), 'utf-8')).toBe(configText);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each(['generated/contract.json', 'generated/contract.d.ts'])(
    'refuses to write over the emitted contract file %s',
    async (output) => {
      const dir = await projectDir();

      const run = await harness(ormConfig(dir)).run(
        ['contract', 'print', '--output', output, '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(erroredEnvelope(run).error).toMatchObject({
        code: 'CONTRACT.PRINT_OUTPUT_IS_PROJECT_FILE',
        summary: 'contract print would write over an emitted contract file',
        meta: { output, file: output },
      });
      expect(await readdir(dir)).not.toContain('generated');
    },
  );

  it('refuses an output path inside a directory the contract source reads', async () => {
    const dir = await projectDir();
    const config = ormConfig(dir, {
      contract: {
        source: { format: 'psl', inputs: ['./prisma'], load: mocks.load },
        output: join(dir, 'generated', 'contract.json'),
      },
    });

    const run = await harness(config).run(
      ['contract', 'print', '--output', 'prisma/nested/contract.prisma', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(erroredEnvelope(run).error).toMatchObject({ code: 'CONTRACT.PRINT_OUTPUT_IS_SOURCE' });
    expect(await readdir(dir)).not.toContain('prisma');
  });
});
