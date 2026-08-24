import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

/**
 * Every case here re-scaffolds over files that are already on disk, which is
 * the destructive act the consent token exists for. Both skip flags are
 * passed, so no run needs a package-manager runner and none is seeded.
 */
const NO_PACKAGE_WORK = ['--skip-install'] as const;

const SCHEMA_PATH = 'src/prisma/contract.prisma';
const HAND_WRITTEN_SCHEMA = 'model KeepMe {\n  id String @id\n}\n';
const HAND_WRITTEN_CONFIG = 'export default {}\n';

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-reinit');
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

function scaffoldArgv(...extra: string[]): string[] {
  return ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...extra];
}

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

function readProjectFile(relative: string): string {
  return readFileSync(join(projectDir, relative), 'utf-8');
}

describe('re-scaffolding over an existing project', () => {
  describe('a project with a generated config', () => {
    beforeEach(() => {
      writeProjectFile('prisma.config.ts', HAND_WRITTEN_CONFIG);
    });

    it(
      'proceeds when the consent token is typed back',
      async () => {
        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['', basename(projectDir), false],
        });

        expect(run.exitCode).toBe(0);
        expect(readProjectFile('prisma.config.ts')).toContain('defineConfig');
      },
      timeouts.coldTransformImport,
    );

    it(
      'refuses when the typed answer is not the token',
      async () => {
        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['', 'no'],
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.PROMPT_INVALID' } });
        expect(readProjectFile('prisma.config.ts')).toBe(HAND_WRITTEN_CONFIG);
      },
      timeouts.coldTransformImport,
    );

    it(
      'exits 3 when the prompt is cancelled outright',
      async () => {
        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), {
          cwd: projectDir,
          isTty: { stdin: true },
          stdin: '',
        });

        expect(run.exitCode).toBe(3);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.PROMPT_CANCELLED' },
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'grants the consent non-interactively through --confirm',
      async () => {
        const run = await harness().run(
          scaffoldArgv('--confirm', basename(projectDir), ...NO_PACKAGE_WORK),
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({ ok: true });
      },
      timeouts.coldTransformImport,
    );

    it(
      'names the token it wants when a non-interactive run offers none',
      async () => {
        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), { cwd: projectDir });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: {
            code: 'CLI.CONSENT_REQUIRED',
            meta: { consentToken: basename(projectDir) },
          },
        });
        expect(readProjectFile('prisma.config.ts')).toBe(HAND_WRITTEN_CONFIG);
      },
      timeouts.coldTransformImport,
    );

    it(
      'refuses --yes as consent',
      async () => {
        const run = await harness().run(scaffoldArgv('--yes', ...NO_PACKAGE_WORK), {
          cwd: projectDir,
          isTty: { stdin: true },
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.CONSENT_REQUIRED' },
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'rejects an unknown --target before asking for anything',
      async () => {
        const run = await harness().run(
          ['orm', 'init', '--target', 'sqlite', '--authoring', 'psl', ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_INVALID_FLAG_VALUE' },
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'asks whether to drop the facade the previous target installed',
      async () => {
        writeProjectFile(
          'package.json',
          `${JSON.stringify({ name: 'app', dependencies: { '@prisma/orm-mongo': '^8.0.0' } }, null, 2)}\n`,
        );

        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['', basename(projectDir), false, true],
        });

        expect(run.exitCode).toBe(0);
        expect(readProjectFile('package.json')).not.toContain('@prisma/orm-mongo');
      },
      timeouts.coldTransformImport,
    );

    it(
      'keeps the previous facade when --keep-previous-facade answers the prompt',
      async () => {
        writeProjectFile(
          'package.json',
          `${JSON.stringify({ name: 'app', dependencies: { '@prisma/orm-mongo': '^8.0.0' } }, null, 2)}\n`,
        );

        const run = await harness().run(
          scaffoldArgv(
            '--keep-previous-facade',
            '--confirm',
            basename(projectDir),
            ...NO_PACKAGE_WORK,
          ),
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(readProjectFile('package.json')).toContain('@prisma/orm-mongo');
      },
      timeouts.coldTransformImport,
    );
  });

  describe('the schema file the consent is really about', () => {
    beforeEach(() => {
      writeProjectFile('prisma.config.ts', HAND_WRITTEN_CONFIG);
      writeProjectFile(SCHEMA_PATH, HAND_WRITTEN_SCHEMA);
    });

    it(
      'replaces the schema the project already had once consent is granted',
      async () => {
        const run = await harness().run(
          scaffoldArgv('--confirm', basename(projectDir), ...NO_PACKAGE_WORK),
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(readProjectFile(SCHEMA_PATH)).toContain('model User {');
        expect(run.presented?.data).toMatchObject({
          filesWritten: expect.arrayContaining([SCHEMA_PATH]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'leaves the schema byte-identical when the consent cannot be asked for',
      async () => {
        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), { cwd: projectDir });

        expect(run.exitCode).toBe(2);
        expect(readProjectFile(SCHEMA_PATH)).toBe(HAND_WRITTEN_SCHEMA);
      },
      timeouts.coldTransformImport,
    );

    it(
      'names the schema path in the question it asks consent for',
      async () => {
        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), { cwd: projectDir });

        expect(envelopeOf(run)).toMatchObject({
          error: { code: 'CLI.CONSENT_REQUIRED', summary: expect.stringContaining(SCHEMA_PATH) },
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('a half-scaffold with no config left', () => {
    it(
      'still asks for consent before replacing the schema and db.ts',
      async () => {
        writeProjectFile(SCHEMA_PATH, HAND_WRITTEN_SCHEMA);
        writeProjectFile('src/prisma/db.ts', 'export const db = null\n');

        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), { cwd: projectDir });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          error: {
            code: 'CLI.CONSENT_REQUIRED',
            summary: expect.stringContaining('src/prisma/db.ts'),
          },
        });
        expect(readProjectFile(SCHEMA_PATH)).toBe(HAND_WRITTEN_SCHEMA);
        expect(existsSync(join(projectDir, 'prisma.config.ts'))).toBe(false);
      },
      timeouts.coldTransformImport,
    );

    it(
      'asks for nothing when the only file in the way is a hand-written .env.example',
      async () => {
        writeProjectFile('.env.example', 'SOMETHING_ELSE=1\n');

        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          warnings: expect.arrayContaining([expect.stringContaining('.env.example')]),
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('a directory whose name needs trimming', () => {
    let spacedDir: string;

    beforeEach(() => {
      spacedDir = join(projectDir, 'my app ');
      mkdirSync(spacedDir, { recursive: true });
      writeFileSync(join(spacedDir, 'prisma.config.ts'), HAND_WRITTEN_CONFIG, 'utf-8');
    });

    it(
      'asks for a token the user can actually type',
      async () => {
        const run = await harness().run(scaffoldArgv(...NO_PACKAGE_WORK), { cwd: spacedDir });

        expect(envelopeOf(run)).toMatchObject({
          error: { code: 'CLI.CONSENT_REQUIRED', meta: { consentToken: 'my app' } },
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'accepts that token from --confirm',
      async () => {
        const run = await harness().run(scaffoldArgv('--confirm', 'my app', ...NO_PACKAGE_WORK), {
          cwd: spacedDir,
        });

        expect(run.exitCode).toBe(0);
      },
      timeouts.coldTransformImport,
    );
  });
});
