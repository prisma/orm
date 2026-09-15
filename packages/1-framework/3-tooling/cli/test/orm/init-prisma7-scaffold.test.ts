import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import type { ResolvedInitInputs } from '../../src/orm/init-inputs';
import { scaffoldProject } from '../../src/orm/init-scaffold';
import { createTestProjectDir, fixtureAppDir } from '../utils/test-project-dir';

const FIXTURE = join(fixtureAppDir, 'fixtures/prisma7-project');
const SKIP_INSTALL = ['--skip-install'] as const;
const FROM_PRISMA7 = ['--from-prisma7-schema', 'prisma/schema.prisma'] as const;

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-scaffold');
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

function readManifestScripts(): Record<string, string> {
  return JSON.parse(readProjectFile('package.json'))['scripts'];
}

function writeManifestWithScript(script: string): void {
  writeProjectFile(
    'package.json',
    `${JSON.stringify(
      { name: 'app', scripts: { run: script }, devDependencies: { prisma: '^7.4.0' } },
      null,
      2,
    )}\n`,
  );
}

/**
 * The fixture's config imports `prisma/config`, which nothing in the fixture
 * package resolves. A stub `prisma` under the project's own `node_modules`
 * stands in for the installed Prisma 7 the config was written against.
 */
function installFakePrisma7(version = '7.4.1'): void {
  writeProjectFile(
    'node_modules/prisma/package.json',
    JSON.stringify({ name: 'prisma', version, exports: { './config': './config.js' } }),
  );
  writeProjectFile('node_modules/prisma/config.js', 'export const defineConfig = (c) => c;\n');
}

/**
 * The fixture keeps its manifest as `package.json.fixture`: a `package.json`
 * declaring Prisma 7 inside the workspace would become a workspace package
 * and put Prisma 7 in the lockfile.
 */
function copyFixture(): void {
  cpSync(FIXTURE, projectDir, { recursive: true });
  renameSync(join(projectDir, 'package.json.fixture'), join(projectDir, 'package.json'));
  installFakePrisma7();
}

/**
 * The config init writes calls `prisma7Schema` from the facade's `/config`
 * entrypoint, which the facade on this branch does not export yet. A re-init
 * evaluates that config, so the entrypoint is shimmed under the project's own
 * `node_modules` until the Prisma 7 contract source lands on main.
 */
function installFakeFacadeConfig(): void {
  writeProjectFile(
    'node_modules/@prisma/orm-postgres/package.json',
    JSON.stringify({ name: '@prisma/orm-postgres', exports: { './config': './config.js' } }),
  );
  writeProjectFile(
    'node_modules/@prisma/orm-postgres/config.js',
    'export const defineConfig = (c) => c;\nexport const prisma7Schema = (schema, options) => ({ schema, ...options });\n',
  );
}

function hashTree(dir: string): string {
  const hash = createHash('sha256');
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    hash.update(file.slice(dir.length));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

function prisma7Inputs(overrides: Partial<ResolvedInitInputs> = {}): ResolvedInitInputs {
  return {
    target: 'postgres',
    authoring: 'psl',
    schemaPath: 'prisma/schema.prisma',
    contractSource: {
      kind: 'prisma7-schema',
      schemaPath: 'prisma/schema.prisma',
      provider: 'postgresql',
      targetSource: 'provider',
    },
    sideBySide: null,
    warnings: [],
    install: false,
    writeEnv: false,
    probeDb: false,
    strictProbe: false,
    reinit: false,
    removePreviousFacade: null,
    ...overrides,
  };
}

function scaffold(overrides: Partial<ResolvedInitInputs> = {}) {
  return scaffoldProject({
    cwd: projectDir,
    inputs: prisma7Inputs(overrides),
    packageManager: 'pnpm',
  });
}

const PLAN = {
  renameConfig: { from: 'prisma.config.ts', extension: 'ts' },
  movePackages: { cliVersion: '^7.4.0', clientVersion: '^7.4.0' },
} as const;

const FIXTURE_SCRIPTS_AFTER = {
  generate: 'prisma7 generate',
  migrate: 'prisma7 migrate dev',
  studio: 'prisma7 studio',
  'contract:emit': 'prisma contract emit',
};

describe('the Prisma 7 scaffold', () => {
  describe('files written', () => {
    it('points the config at the schema through prisma7Schema and writes db.ts under src/prisma', () => {
      copyFixture();

      const outcome = scaffold();

      expect(readProjectFile('prisma.config.ts')).toContain(
        "import { defineConfig as ormConfig, prisma7Schema } from '@prisma/orm-postgres/config';",
      );
      expect(readProjectFile('prisma.config.ts')).toContain(
        "contract: prisma7Schema('prisma/schema.prisma', { output: 'src/prisma/contract.json' }),",
      );
      expect(readProjectFile('src/prisma/db.ts')).toContain(
        "import type { Contract } from './contract.d';",
      );
      expect(readProjectFile('src/prisma/db.ts')).toContain(
        "from './contract.json' with { type: 'json' };",
      );
      expect(readProjectFile('.gitattributes')).toContain(
        'src/prisma/contract.json linguist-generated',
      );
      expect(outcome.filesWritten).toEqual(
        expect.arrayContaining(['prisma.config.ts', 'src/prisma/db.ts', 'prisma-8.md']),
      );
      expect(outcome.filesWritten).not.toContain('prisma/schema.prisma');
      expect(existsSync(join(projectDir, 'prisma/db.ts'))).toBe(false);
    });

    it('writes a quick reference about the Prisma 7 schema and the transition loop', () => {
      copyFixture();

      scaffold();

      const reference = readProjectFile('prisma-8.md');
      expect(reference).toContain('prisma/schema.prisma');
      expect(reference).toContain('prisma7 migrate dev');
      expect(reference).toContain('pnpm prisma db sign');
      expect(reference).not.toContain('model User');
    });

    it('writes no README even when the project has src/index.ts', () => {
      copyFixture();
      writeProjectFile('src/index.ts', 'export {};\n');

      const outcome = scaffold();

      expect(existsSync(join(projectDir, 'README.md'))).toBe(false);
      expect(outcome.filesWritten).not.toContain('README.md');
    });

    it('leaves prisma/ byte-identical', () => {
      copyFixture();
      const before = hashTree(join(projectDir, 'prisma'));

      scaffold();

      expect(hashTree(join(projectDir, 'prisma'))).toBe(before);
    });

    it('cleans stale artifacts under src/prisma on a re-init, never under prisma/', () => {
      copyFixture();
      writeProjectFile('src/prisma/contract.json', '{}');
      writeProjectFile('prisma/contract.json', '{}');

      const outcome = scaffold({ reinit: true });

      expect(outcome.filesDeleted).toEqual(['src/prisma/contract.json']);
      expect(existsSync(join(projectDir, 'prisma/contract.json'))).toBe(true);
    });
  });

  describe('the side-by-side edits', () => {
    it('renames the Prisma 7 config, rewrites its import, and writes its own config in its place', () => {
      copyFixture();
      const original = readProjectFile('prisma.config.ts');

      const outcome = scaffold({ sideBySide: PLAN });

      expect(readProjectFile('prisma7.config.ts')).toBe(
        original.replace("from 'prisma/config'", "from '@prisma/prisma7/config'"),
      );
      expect(readProjectFile('prisma.config.ts')).toContain('prisma7Schema(');
      expect(outcome.filesRenamed).toEqual([{ from: 'prisma.config.ts', to: 'prisma7.config.ts' }]);
      expect(outcome.filesWritten).not.toContain('prisma7.config.ts');
      expect(outcome.warnings).toEqual([]);
    });

    it('rewrites a double-quoted import too, and keeps the extension', () => {
      copyFixture();
      rmSync(join(projectDir, 'prisma.config.ts'));
      writeProjectFile(
        'prisma.config.mjs',
        'import { defineConfig } from "prisma/config";\nexport default defineConfig({});\n',
      );

      scaffold({
        sideBySide: { ...PLAN, renameConfig: { from: 'prisma.config.mjs', extension: 'mjs' } },
      });

      expect(readProjectFile('prisma7.config.mjs')).toBe(
        'import { defineConfig } from "@prisma/prisma7/config";\nexport default defineConfig({});\n',
      );
      expect(existsSync(join(projectDir, 'prisma.config.mjs'))).toBe(false);
    });

    it('warns and renames anyway when the prisma/config import is not found', () => {
      copyFixture();
      writeProjectFile('prisma.config.ts', "export default { schema: 'prisma/schema.prisma' };\n");

      const outcome = scaffold({ sideBySide: PLAN });

      expect(readProjectFile('prisma7.config.ts')).toBe(
        "export default { schema: 'prisma/schema.prisma' };\n",
      );
      expect(outcome.warnings).toEqual([expect.stringContaining('prisma/config')]);
    });

    it('refuses to rename onto an existing prisma7.config.* and writes nothing', () => {
      copyFixture();
      writeProjectFile('prisma7.config.ts', 'export default {};\n');
      const before = hashTree(projectDir);

      expect(() => scaffold({ sideBySide: PLAN })).toThrow(
        expect.objectContaining({ code: 'CLI.INIT_PRISMA7_CONFIG_COLLISION' }),
      );
      expect(hashTree(projectDir)).toBe(before);
    });

    it('names the completed rename when a later write fails', () => {
      copyFixture();
      writeFileSync(join(projectDir, 'src'), 'a file where the directory should go', 'utf-8');

      expect(() => scaffold({ sideBySide: PLAN })).toThrow(
        expect.objectContaining({
          code: 'CLI.INIT_WRITE_FAILED',
          meta: expect.objectContaining({
            filesWritten: ['prisma.config.ts'],
            filesRenamed: [{ from: 'prisma.config.ts', to: 'prisma7.config.ts' }],
          }),
        }),
      );
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(true);
    });

    it('renames nothing when the plan has no rename', () => {
      copyFixture();
      rmSync(join(projectDir, 'prisma.config.ts'));

      const outcome = scaffold({ sideBySide: { ...PLAN, renameConfig: null } });

      expect(outcome.filesRenamed).toEqual([]);
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(false);
    });

    it.each([
      ['at the start', 'prisma migrate dev', 'prisma7 migrate dev'],
      ['after &&', 'tsc && prisma generate', 'tsc && prisma7 generate'],
      ['after ||', 'true || prisma generate', 'true || prisma7 generate'],
      ['after ;', 'echo x; prisma studio', 'echo x; prisma7 studio'],
      ['after |', 'cat x | prisma format', 'cat x | prisma7 format'],
      ['after pnpm', 'pnpm prisma generate', 'pnpm prisma7 generate'],
      ['after the npm runner', 'np' + 'x prisma migrate deploy', 'np' + 'x prisma7 migrate deploy'],
      ['after yarn', 'yarn prisma generate', 'yarn prisma7 generate'],
      ['after bun', 'bun prisma generate', 'bun prisma7 generate'],
      ['after --', 'dotenv -e .env -- prisma migrate dev', 'dotenv -e .env -- prisma7 migrate dev'],
      [
        'after an environment assignment',
        'NODE_OPTIONS=--max-old-space-size=4096 prisma studio',
        'NODE_OPTIONS=--max-old-space-size=4096 prisma7 studio',
      ],
      [
        'after several environment assignments',
        'A=1 B=two prisma generate',
        'A=1 B=two prisma7 generate',
      ],
      [
        'twice in one script',
        'prisma generate && prisma migrate dev',
        'prisma7 generate && prisma7 migrate dev',
      ],
    ])('rewrites the prisma binary %s', (_case, script, rewritten) => {
      copyFixture();
      writeManifestWithScript(script);

      scaffold({ sideBySide: PLAN });

      expect(readManifestScripts()['run']).toBe(rewritten);
    });

    it.each([
      ['a script that does not invoke prisma', 'biome check .'],
      ['a prisma-prefixed binary', 'prisma-erd generate'],
      ['a prisma package spec', 'np' + 'x prisma@7 generate'],
      ['a path argument named prisma', 'tsx scripts/seed.ts prisma'],
    ])('leaves %s alone', (_case, script) => {
      copyFixture();
      writeManifestWithScript(script);

      scaffold({ sideBySide: PLAN });

      expect(readManifestScripts()['run']).toBe(script);
    });

    it('rewrites the fixture scripts and adds contract:emit with the Prisma 8 binary', () => {
      copyFixture();

      scaffold({ sideBySide: PLAN });

      expect(readManifestScripts()).toEqual(FIXTURE_SCRIPTS_AFTER);
    });

    it('does not rewrite the scripts init adds on a re-init', () => {
      copyFixture();
      scaffold({ sideBySide: PLAN });

      scaffold({ sideBySide: { ...PLAN, renameConfig: null }, reinit: true });

      expect(readManifestScripts()).toEqual(FIXTURE_SCRIPTS_AFTER);
    });

    it('edits nothing when the plan is null', () => {
      copyFixture();

      scaffold();

      expect(readManifestScripts()['generate']).toBe('prisma generate');
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(false);
    });
  });

  describe('through the CLI', () => {
    it(
      'sets the fixture up beside Prisma 7 and lists the Prisma 7 packages when skipping the install',
      async () => {
        copyFixture();
        const before = hashTree(join(projectDir, 'prisma'));

        const run = await harness().run(
          ['orm', 'init', ...FROM_PRISMA7, '--confirm', basename(projectDir), ...SKIP_INSTALL],
          { cwd: projectDir },
        );

        expect(run.exitCode).toBe(0);
        expect(hashTree(join(projectDir, 'prisma'))).toBe(before);
        expect(readProjectFile('prisma7.config.ts')).toContain("from '@prisma/prisma7/config'");
        expect(readProjectFile('prisma.config.ts')).toContain('prisma7Schema(');
        expect(existsSync(join(projectDir, 'src/prisma/db.ts'))).toBe(true);
        expect(readManifestScripts()['migrate']).toBe('prisma7 migrate dev');
        expect(run.presented?.presentation.next).toContainEqual(
          expect.objectContaining({
            kind: 'user-choice',
            label: expect.stringContaining('@prisma/prisma7@7'),
          }),
        );
      },
      timeouts.coldTransformImport,
    );

    it(
      're-initialises an already set up fixture without touching what Prisma 7 owns',
      async () => {
        copyFixture();
        installFakeFacadeConfig();
        const token = basename(projectDir);
        await harness().run(['orm', 'init', ...FROM_PRISMA7, '--confirm', token, ...SKIP_INSTALL], {
          cwd: projectDir,
        });
        const prismaBefore = hashTree(join(projectDir, 'prisma'));
        const prisma7Config = readProjectFile('prisma7.config.ts');

        const run = await harness().run(
          ['orm', 'init', ...FROM_PRISMA7, '--confirm', token, '--confirm', token, ...SKIP_INSTALL],
          { cwd: projectDir },
        );

        expect(envelopeOf(run)?.error).toBeUndefined();
        expect(run.exitCode).toBe(0);
        expect(hashTree(join(projectDir, 'prisma'))).toBe(prismaBefore);
        expect(readProjectFile('prisma7.config.ts')).toBe(prisma7Config);
        expect(readManifestScripts()['migrate']).toBe('prisma7 migrate dev');
      },
      timeouts.coldTransformImport,
    );
  });
});
