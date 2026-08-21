import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

/**
 * `init` reaches its package-manager capability only when it installs; every
 * case here passes both skip flags, so no run needs a package-manager runner
 * and none is seeded.
 */
const NO_PACKAGE_WORK = ['--skip-install'] as const;

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prompts');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness() {
  return createTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS });
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

describe('init prompts', () => {
  describe('an interactive run with no flags', () => {
    it(
      'asks for target, authoring, schema path and the .env file, in that order',
      async () => {
        const run = await harness().run(['orm', 'init', ...NO_PACKAGE_WORK], {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['postgres', 'psl', 'src/prisma/contract.prisma', true],
        });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          ok: true,
          target: 'postgres',
          authoring: 'psl',
          schemaPath: 'src/prisma/contract.prisma',
        });
        expect(existsSync(join(projectDir, 'src/prisma/contract.prisma'))).toBe(true);
        expect(existsSync(join(projectDir, '.env'))).toBe(true);
      },
      timeouts.coldTransformImport,
    );

    it(
      'takes the schema path the text prompt answered, not the default',
      async () => {
        const run = await harness().run(['orm', 'init', ...NO_PACKAGE_WORK], {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['mongo', 'typescript', 'db/schema.ts', false],
        });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          target: 'mongodb',
          authoring: 'typescript',
          schemaPath: 'db/schema.ts',
        });
        expect(existsSync(join(projectDir, '.env'))).toBe(false);
      },
      timeouts.coldTransformImport,
    );

    it(
      'rejects a schema path whose extension contradicts the authoring style',
      async () => {
        const run = await harness().run(['orm', 'init', ...NO_PACKAGE_WORK], {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['postgres', 'psl', 'db/schema.ts', false],
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH' },
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('--yes', () => {
    it(
      'answers every defaulted prompt and still needs the two undefaulted flags',
      async () => {
        const run = await harness().run(
          [
            'orm',
            'init',
            '--yes',
            '--target',
            'postgresql',
            '--authoring',
            'TS',
            ...NO_PACKAGE_WORK,
          ],
          { cwd: projectDir, isTty: { stdin: true } },
        );

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          target: 'postgres',
          authoring: 'typescript',
          schemaPath: 'src/prisma/contract.ts',
        });
        expect(existsSync(join(projectDir, '.env'))).toBe(false);
      },
      timeouts.coldTransformImport,
    );

    it(
      'cannot answer the target prompt, which has no default',
      async () => {
        const run = await harness().run(['orm', 'init', '--yes', ...NO_PACKAGE_WORK], {
          cwd: projectDir,
          isTty: { stdin: true },
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: {
            code: 'CLI.INIT_MISSING_FLAGS',
            meta: { missingFlags: ['target', 'authoring'] },
          },
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('a non-interactive run', () => {
    it(
      'scaffolds from flags alone',
      async () => {
        const run = await harness().run(
          [
            'orm',
            'init',
            '--target',
            'mongodb',
            '--authoring',
            'psl',
            '--schema-path',
            'prisma/contract.prisma',
            '--write-env',
            ...NO_PACKAGE_WORK,
          ],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          target: 'mongodb',
          authoring: 'psl',
          schemaPath: 'prisma/contract.prisma',
        });
        expect(existsSync(join(projectDir, 'prisma/contract.prisma'))).toBe(true);
        expect(existsSync(join(projectDir, '.env'))).toBe(true);
      },
      timeouts.coldTransformImport,
    );

    it(
      'names every missing required flag rather than prompting',
      async () => {
        const run = await harness().run(['orm', 'init', '--authoring', 'psl', ...NO_PACKAGE_WORK], {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_MISSING_FLAGS', meta: { missingFlags: ['target'] } },
        });
        expect(existsSync(join(projectDir, 'prisma.config.ts'))).toBe(false);
      },
      timeouts.coldTransformImport,
    );

    it(
      'falls back to the default schema path instead of asking for one',
      async () => {
        const run = await harness().run(
          ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({ schemaPath: 'src/prisma/contract.prisma' });
      },
      timeouts.coldTransformImport,
    );

    it(
      'rejects an unknown --target value with the allowed set',
      async () => {
        const run = await harness().run(
          ['orm', 'init', '--target', 'sqlite', '--authoring', 'psl', ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: {
            code: 'CLI.INIT_INVALID_FLAG_VALUE',
            meta: { flag: 'target', allowed: ['postgres', 'mongodb'] },
          },
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'refuses --strict-probe without --probe-db',
      async () => {
        const run = await harness().run(
          [
            'orm',
            'init',
            '--target',
            'postgres',
            '--authoring',
            'psl',
            '--strict-probe',
            ...NO_PACKAGE_WORK,
          ],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_STRICT_PROBE_WITHOUT_PROBE' },
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('preconditions', () => {
    it(
      'leaves the working tree untouched when package.json will not parse',
      async () => {
        writeFileSync(join(projectDir, 'package.json'), '{ not json', 'utf-8');

        const run = await harness().run(
          ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_INVALID_MANIFEST' },
        });
        expect(existsSync(join(projectDir, 'prisma.config.ts'))).toBe(false);
      },
      timeouts.coldTransformImport,
    );

    it(
      'leaves the working tree untouched when tsconfig.json will not parse',
      async () => {
        writeFileSync(join(projectDir, 'tsconfig.json'), '{ "compilerOptions": ', 'utf-8');

        const run = await harness().run(
          ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_INVALID_TSCONFIG' },
        });
        expect(existsSync(join(projectDir, 'prisma.config.ts'))).toBe(false);
      },
      timeouts.coldTransformImport,
    );
  });

  describe('presentation', () => {
    it(
      'renders the scaffold as fields, a file tree and the next steps',
      async () => {
        const run = await harness().run(
          ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...NO_PACKAGE_WORK],
          { cwd: projectDir, isTty: { stdout: true } },
        );
        const blocks = run.presented?.presentation.human ?? [];

        expect(blocks[0]).toEqual({
          kind: 'fields',
          rail: true,
          rows: [
            { label: 'target', value: 'postgres' },
            { label: 'authoring', value: 'psl' },
            { label: 'schema', value: 'src/prisma/contract.prisma' },
          ],
        });
        expect(blocks.some((block) => block.kind === 'tree')).toBe(true);
        expect(blocks.at(-1)).toMatchObject({ kind: 'summary', status: 'ok' });
        expect(run.presented?.presentation.stdout).toEqual([]);
        expect(run.presented?.presentation.next.length).toBeGreaterThan(0);
      },
      timeouts.coldTransformImport,
    );

    it(
      'writes the success document as the json presentation',
      async () => {
        const run = await harness().run(
          ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.presented?.presentation.json).toMatchObject({
          ok: true,
          target: 'postgres',
          authoring: 'psl',
          schemaPath: 'src/prisma/contract.prisma',
          packagesInstalled: { status: 'skipped', deps: [], devDeps: [] },
          contractEmitted: false,
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('files the scaffold merges rather than clobbers', () => {
    it(
      'keeps an existing .env and warns instead of overwriting it',
      async () => {
        writeFileSync(join(projectDir, '.env'), 'DATABASE_URL=keep-me\n', 'utf-8');

        const run = await harness().run(
          [
            'orm',
            'init',
            '--target',
            'postgres',
            '--authoring',
            'psl',
            '--write-env',
            ...NO_PACKAGE_WORK,
          ],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(readFileSync(join(projectDir, '.env'), 'utf-8')).toBe('DATABASE_URL=keep-me\n');
        expect(run.events).toContainEqual(
          expect.objectContaining({ kind: 'message', severity: 'warn' }),
        );
      },
      timeouts.coldTransformImport,
    );

    it(
      'removes the stale contract artifacts a previous run emitted',
      async () => {
        writeFileSync(join(projectDir, 'prisma.config.ts'), 'export default {}\n', 'utf-8');
        mkdirSync(join(projectDir, 'src/prisma'), { recursive: true });
        writeFileSync(join(projectDir, 'src/prisma/contract.json'), '{}', 'utf-8');

        const run = await harness().run(
          [
            'orm',
            'init',
            '--target',
            'postgres',
            '--authoring',
            'psl',
            '--confirm',
            basename(projectDir),
            ...NO_PACKAGE_WORK,
          ],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          filesDeleted: ['src/prisma/contract.json'],
        });
        expect(existsSync(join(projectDir, 'src/prisma/contract.json'))).toBe(false);
      },
      timeouts.coldTransformImport,
    );
  });
});
