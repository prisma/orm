import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateConfigModule } from '../src/load';

const PRISMA_8_CONFIG_SOURCE = `
export default { $prismaConfig: 1, orm: { family: { kind: 'family' } } };
`;

const PRISMA_7_CONFIG_SOURCE = `
export default {
  schema: 'db/schema.prisma',
  migrations: { path: 'db/migrations' },
};
`;

describe('evaluateConfigModule', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'prisma-8-config-module-')));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it(
    'returns the raw default export of a marked Prisma 8 config without unwrapping the orm section',
    async () => {
      const configPath = join(tempDir, 'prisma.config.ts');
      writeFileSync(configPath, PRISMA_8_CONFIG_SOURCE, 'utf-8');

      const result = await evaluateConfigModule(configPath);

      expect(result.assertOk()).toEqual({
        $prismaConfig: 1,
        orm: { family: { kind: 'family' } },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'returns the default export of a Prisma 7 shaped config that carries no marker',
    async () => {
      const configPath = join(tempDir, 'prisma7.config.ts');
      writeFileSync(configPath, PRISMA_7_CONFIG_SOURCE, 'utf-8');

      const result = await evaluateConfigModule(configPath);

      expect(result.assertOk()).toEqual({
        schema: 'db/schema.prisma',
        migrations: { path: 'db/migrations' },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'returns the requested file alone, not what an extended base contributes to the merged config',
    async () => {
      writeFileSync(join(tempDir, 'base.config.ts'), PRISMA_8_CONFIG_SOURCE, 'utf-8');
      const configPath = join(tempDir, 'prisma.config.ts');
      writeFileSync(
        configPath,
        "export default { schema: 'db/schema.prisma', extends: './base.config.ts' };\n",
        'utf-8',
      );

      const result = await evaluateConfigModule(configPath);

      expect(result.assertOk()).toEqual({
        schema: 'db/schema.prisma',
        extends: './base.config.ts',
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'maps a module that throws to CONFIG.EVALUATION_FAILED carrying the thrown message',
    async () => {
      const configPath = join(tempDir, 'prisma.config.ts');
      writeFileSync(configPath, "throw new Error('config module exploded');", 'utf-8');

      const result = await evaluateConfigModule(configPath);

      expect(result.assertNotOk()).toMatchObject({
        name: 'CliStructuredError',
        code: 'CONFIG.EVALUATION_FAILED',
        why: expect.stringContaining('config module exploded'),
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'maps an unresolvable import to CONFIG.EVALUATION_FAILED',
    async () => {
      const configPath = join(tempDir, 'prisma.config.ts');
      // Not `prisma/config`: the workspace's pnpm store hoists a Prisma 7 for the
      // examples, and jiti's resolver falls back to it.
      writeFileSync(
        configPath,
        "import { defineConfig } from 'a-package-that-is-not-installed/config';\nexport default defineConfig({});\n",
        'utf-8',
      );

      const result = await evaluateConfigModule(configPath);

      expect(result.assertNotOk().code).toBe('CONFIG.EVALUATION_FAILED');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'maps a path with no file to CONFIG.FILE_NOT_FOUND',
    async () => {
      const configPath = join(tempDir, 'prisma.config.ts');

      const result = await evaluateConfigModule(configPath);

      expect(result.assertNotOk()).toMatchObject({
        code: 'CONFIG.FILE_NOT_FOUND',
        where: { path: configPath },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'resolves a relative path against the cwd option',
    async () => {
      writeFileSync(join(tempDir, 'prisma7.config.mjs'), PRISMA_7_CONFIG_SOURCE, 'utf-8');

      const result = await evaluateConfigModule('prisma7.config.mjs', { cwd: tempDir });

      expect(result.assertOk()).toMatchObject({ schema: 'db/schema.prisma' });
    },
    timeouts.typeScriptCompilation,
  );
});
