import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const NO_PACKAGE_WORK = ['--skip-install'] as const;
const FROM_PRISMA7 = ['--from-prisma7-schema', 'prisma/schema.prisma'] as const;

const PRISMA7_SCHEMA =
  'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel User {\n  id String @id\n}\n';
const PRISMA7_CONFIG = "export default { schema: 'prisma/schema.prisma' };\n";

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-prompts');
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

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

function readProjectFile(relative: string): string {
  return readFileSync(join(projectDir, relative), 'utf-8');
}

function writePrisma7Project(provider = 'postgresql'): void {
  writeProjectFile('prisma/schema.prisma', PRISMA7_SCHEMA.replace('postgresql', provider));
}

function expectNothingWritten(): void {
  expect(existsSync(join(projectDir, 'prisma-8.md'))).toBe(false);
  expect(existsSync(join(projectDir, 'src'))).toBe(false);
}

describe('init on a Prisma 7 project', () => {
  describe('--from-prisma7-schema', () => {
    it(
      'sets the project up with the schema as the contract source and leaves the schema untouched',
      async () => {
        writePrisma7Project();

        const run = await harness().run(['orm', 'init', ...FROM_PRISMA7, ...NO_PACKAGE_WORK], {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          ok: true,
          target: 'postgres',
          schemaPath: 'prisma/schema.prisma',
        });
        expect(readProjectFile('prisma/schema.prisma')).toBe(PRISMA7_SCHEMA);
        expect(readdirSync(join(projectDir, 'prisma'))).toEqual(['schema.prisma']);
        expect(existsSync(join(projectDir, 'prisma.config.ts'))).toBe(true);
        expect(existsSync(join(projectDir, 'src/prisma/db.ts'))).toBe(true);
      },
      timeouts.coldTransformImport,
    );

    it(
      'refuses --schema-path beside it before anything is written',
      async () => {
        writePrisma7Project();

        const run = await harness().run(
          ['orm', 'init', ...FROM_PRISMA7, '--schema-path', 'db/x.prisma', ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_FLAG_CONFLICT' },
        });
        expectNothingWritten();
      },
      timeouts.coldTransformImport,
    );
  });

  describe('refusals write nothing', () => {
    it.each([
      [
        'a --target that disagrees with the provider',
        'postgresql',
        ['--target', 'mongodb'],
        'CLI.INIT_PRISMA7_TARGET_MISMATCH',
      ],
      ['an unsupported provider', 'sqlite', [], 'CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED'],
    ])(
      '%s',
      async (_case, provider, extraArgs, code) => {
        writePrisma7Project(provider);

        const run = await harness().run(
          ['orm', 'init', ...FROM_PRISMA7, ...extraArgs, ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code } });
        expectNothingWritten();
      },
      timeouts.coldTransformImport,
    );

    it(
      'a schema without a datasource block',
      async () => {
        writeProjectFile('prisma/schema.prisma', 'model User {\n  id String @id\n}\n');

        const run = await harness().run(['orm', 'init', ...FROM_PRISMA7, ...NO_PACKAGE_WORK], {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_PRISMA7_SCHEMA_INVALID' },
        });
        expectNothingWritten();
      },
      timeouts.coldTransformImport,
    );

    it(
      'a Prisma 7 prisma.config.ts beside a prisma7.config.ts',
      async () => {
        writePrisma7Project();
        writeProjectFile('prisma.config.ts', PRISMA7_CONFIG);
        writeProjectFile('prisma7.config.ts', PRISMA7_CONFIG);

        const run = await harness().run(['orm', 'init', ...FROM_PRISMA7, ...NO_PACKAGE_WORK], {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_PRISMA7_CONFIG_COLLISION' },
        });
        expect(readProjectFile('prisma.config.ts')).toBe(PRISMA7_CONFIG);
        expectNothingWritten();
      },
      timeouts.coldTransformImport,
    );
  });

  describe('the interactive question', () => {
    it(
      'enters the Prisma 7 path on a yes',
      async () => {
        writePrisma7Project();

        const run = await harness().run(['orm', 'init', ...NO_PACKAGE_WORK], {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: [true, false],
        });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          target: 'postgres',
          schemaPath: 'prisma/schema.prisma',
        });
        expect(readProjectFile('prisma/schema.prisma')).toBe(PRISMA7_SCHEMA);
      },
      timeouts.coldTransformImport,
    );

    it(
      'runs init as today on a no',
      async () => {
        writePrisma7Project();

        const run = await harness().run(['orm', 'init', ...NO_PACKAGE_WORK], {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: [false, 'postgres', 'psl', 'src/prisma/contract.prisma', false],
        });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          authoring: 'psl',
          schemaPath: 'src/prisma/contract.prisma',
        });
        expect(existsSync(join(projectDir, 'src/prisma/contract.prisma'))).toBe(true);
      },
      timeouts.coldTransformImport,
    );

    it(
      'is never answered for the user by --yes or a non-interactive session',
      async () => {
        writePrisma7Project();

        const run = await harness().run(
          ['orm', 'init', '--yes', '--target', 'postgres', ...NO_PACKAGE_WORK],
          { cwd: projectDir, isTty: { stdin: true } },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_MISSING_FLAGS', meta: { missingFlags: ['authoring'] } },
        });
        expectNothingWritten();
      },
      timeouts.coldTransformImport,
    );
  });

  describe('the side-by-side consent', () => {
    beforeEach(() => {
      writePrisma7Project();
      writeProjectFile(
        'package.json',
        `${JSON.stringify({ name: 'app', devDependencies: { prisma: '^7.3.0' } }, null, 2)}\n`,
      );
    });

    it(
      'names the token a non-interactive run must pass, and writes nothing',
      async () => {
        const run = await harness().run(['orm', 'init', ...FROM_PRISMA7, ...NO_PACKAGE_WORK], {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.CONSENT_REQUIRED' },
        });
        expectNothingWritten();
      },
      timeouts.coldTransformImport,
    );

    it(
      'is granted through --confirm',
      async () => {
        const run = await harness().run(
          ['orm', 'init', ...FROM_PRISMA7, '--confirm', basename(projectDir), ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({ ok: true });
      },
      timeouts.coldTransformImport,
    );

    it(
      'renames the Prisma 7 config it was asked to keep and writes its own in its place',
      async () => {
        writeProjectFile('prisma.config.ts', PRISMA7_CONFIG);

        const run = await harness().run(
          ['orm', 'init', ...FROM_PRISMA7, '--confirm', basename(projectDir), ...NO_PACKAGE_WORK],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(readProjectFile('prisma7.config.ts')).toBe(PRISMA7_CONFIG);
        expect(readProjectFile('prisma.config.ts')).toContain('prisma7Schema(');
        expect(readProjectFile('prisma/schema.prisma')).toBe(PRISMA7_SCHEMA);
      },
      timeouts.coldTransformImport,
    );
  });
});
