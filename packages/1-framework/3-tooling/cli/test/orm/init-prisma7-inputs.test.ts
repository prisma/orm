import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { PromptSurface } from '@prisma/cli-engine';
import { timeouts } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type InitFlagValues, resolveInitInputs } from '../../src/orm/init-inputs';
import { createTestProjectDir } from '../utils/test-project-dir';

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-inputs');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function flags(overrides: Partial<InitFlagValues> = {}): InitFlagValues {
  return {
    target: undefined,
    authoring: undefined,
    schemaPath: undefined,
    writeEnv: true,
    probeDb: false,
    strictProbe: false,
    skipInstall: true,
    keepPreviousFacade: false,
    fromPrisma7Schema: undefined,
    ...overrides,
  };
}

const PRISMA7_POSTGRES_SCHEMA =
  'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id String @id\n}\n';
const PRISMA7_CONFIG = "export default { schema: 'prisma/schema.prisma' };\n";
const PRISMA8_CONFIG = 'export default { $prismaConfig: 1, orm: {} };\n';
const PRISMA7_QUESTION =
  'prisma/schema.prisma is a Prisma 7 schema. Use it as the Prisma 8 contract source?';
const SIDE_BY_SIDE_QUESTION =
  'Prisma 7 is installed as `prisma`. Keep it as @prisma/prisma7 (binary prisma7) and move `prisma` to Prisma 8?';

interface PromptCall {
  readonly kind: 'confirm' | 'consent' | 'select' | 'text';
  readonly question: string;
  readonly opts: unknown;
}

function promptRequired(question: string): Error {
  return Object.assign(new Error(`cannot ask "${question}"`), { code: 'CLI.PROMPT_REQUIRED' });
}

/**
 * Answers prompts from a script keyed by question text. A question with no
 * scripted answer takes its default; a `confirm` with neither throws the
 * engine's PROMPT_REQUIRED, the way a non-interactive session does.
 */
function scriptedPrompt(answers: Record<string, unknown> = {}): {
  readonly prompt: PromptSurface;
  readonly calls: PromptCall[];
} {
  const calls: PromptCall[] = [];
  const answer = (question: string): unknown => answers[question];
  const prompt: PromptSurface = {
    confirm: async (question, opts) => {
      calls.push({ kind: 'confirm', question, opts });
      const scripted = answer(question) ?? opts?.default;
      if (scripted === undefined) throw promptRequired(question);
      return scripted === true;
    },
    consent: async (question, opts) => {
      calls.push({ kind: 'consent', question, opts });
      return answer(question) === true;
    },
    select: async (question, options, opts) => {
      calls.push({ kind: 'select', question, opts });
      const scripted = answer(question) ?? opts?.default;
      const match = options.find((option) => option.value === scripted);
      if (match === undefined) throw promptRequired(question);
      return match.value;
    },
    text: async (question, opts) => {
      calls.push({ kind: 'text', question, opts });
      return opts?.default ?? '';
    },
    browserWait: async () => undefined,
  };
  return { prompt, calls };
}

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

function writePrisma7Schema(provider = 'postgresql', path = 'prisma/schema.prisma'): void {
  writeProjectFile(path, PRISMA7_POSTGRES_SCHEMA.replace('postgresql', provider));
}

function writeManifest(manifest: Record<string, unknown>): void {
  writeProjectFile('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

const NO_FLAGS = {} as const;

describe(
  'the Prisma 7 path',
  () => {
    describe('flag conflicts', () => {
      it.each([
        ['schema-path', { schemaPath: 'db/contract.prisma' }],
        ['authoring', { authoring: 'psl' }],
      ])('refuses --from-prisma7-schema together with --%s', async (flag, overrides) => {
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, ...overrides, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_FLAG_CONFLICT',
          meta: { flags: ['from-prisma7-schema', flag] },
        });
      });
    });

    describe('--from-prisma7-schema', () => {
      it('takes the schema as the contract source and the provider as the target', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt();

        const inputs = await resolveInitInputs({
          cwd: projectDir,
          flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
          prompt,
        });

        expect(inputs).toMatchObject({
          target: 'postgres',
          schemaPath: 'prisma/schema.prisma',
          contractSource: {
            kind: 'prisma7-schema',
            schemaPath: 'prisma/schema.prisma',
            provider: 'postgresql',
            targetSource: 'provider',
          },
          sideBySide: null,
          reinit: false,
          warnings: [],
        });
        expect(calls.filter((call) => call.kind !== 'confirm')).toEqual([]);
      });

      it('accepts the postgres spelling of the provider', async () => {
        writePrisma7Schema('postgres');
        const { prompt } = scriptedPrompt();

        const inputs = await resolveInitInputs({
          cwd: projectDir,
          flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
          prompt,
        });

        expect(inputs.target).toBe('postgres');
      });

      it('lets --target override the provider', async () => {
        writePrisma7Schema('mongodb');
        const { prompt } = scriptedPrompt();

        const inputs = await resolveInitInputs({
          cwd: projectDir,
          flags: flags({
            ...NO_FLAGS,
            target: 'postgres',
            fromPrisma7Schema: 'prisma/schema.prisma',
          }),
          prompt,
        });

        expect(inputs).toMatchObject({
          target: 'postgres',
          contractSource: { kind: 'prisma7-schema', provider: 'mongodb', targetSource: 'flag' },
        });
      });

      it('refuses a mongodb provider until the Mongo source exists, before any consent', async () => {
        writePrisma7Schema('mongodb');
        writeManifest({ name: 'app', devDependencies: { prisma: '^7.3.0' } });
        const { prompt, calls } = scriptedPrompt();

        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_MONGO_UNSUPPORTED',
          meta: { schemaPath: 'prisma/schema.prisma' },
        });
        expect(calls).toEqual([]);
      });

      it('refuses any other provider and lists the supported ones', async () => {
        writePrisma7Schema('sqlite');
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED',
          meta: {
            schemaPath: 'prisma/schema.prisma',
            provider: 'sqlite',
            supported: ['postgresql'],
          },
        });
      });

      it.each([
        ['has no datasource block', 'model User {\n  id String @id\n}\n', 'no-datasource'],
        ['does not exist', undefined, 'absent'],
      ])('refuses a path that %s', async (_case, content, reason) => {
        if (content !== undefined) writeProjectFile('prisma/schema.prisma', content);
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_SCHEMA_INVALID',
          meta: { schemaPath: 'prisma/schema.prisma', reason },
        });
      });

      it('refuses a Prisma 7 prisma.config.ts beside a prisma7.config.ts', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', PRISMA7_CONFIG);
        writeProjectFile('prisma7.config.ts', PRISMA7_CONFIG);
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_CONFIG_COLLISION',
          meta: { prismaConfigPath: 'prisma.config.ts', prisma7ConfigPath: 'prisma7.config.ts' },
        });
      });

      it('carries an unreadable prisma7.config.ts as a warning, since init never writes it', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma7.config.ts', "import 'a-package-that-is-not-installed';\n");
        const { prompt } = scriptedPrompt();

        const inputs = await resolveInitInputs({
          cwd: projectDir,
          flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
          prompt,
        });

        expect(inputs.warnings).toEqual([expect.stringContaining('prisma7.config.ts')]);
        expect(inputs.sideBySide).toBeNull();
      });

      it('tells the user to fix prisma.config.ts, not rename it, when prisma7.config.ts already exists', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', "throw new Error('config module exploded');\n");
        writeProjectFile('prisma7.config.ts', PRISMA7_CONFIG);
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_CONFIG_UNREADABLE',
          why: expect.stringContaining('config module exploded'),
          fix: expect.stringMatching(
            /install the project's dependencies.*fix the error in `prisma.config.ts`/i,
          ),
          meta: { path: 'prisma.config.ts', prisma7ConfigPath: 'prisma7.config.ts' },
        });
        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.not.toMatchObject({ fix: expect.stringContaining('rename') });
      });

      it('refuses a prisma.config.ts it could not evaluate rather than replace it', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', "throw new Error('config module exploded');\n");
        writeManifest({ name: 'app', devDependencies: { prisma: '^7.3.0' } });
        const { prompt, calls } = scriptedPrompt();

        await expect(
          resolveInitInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_CONFIG_UNREADABLE',
          meta: {
            path: 'prisma.config.ts',
            why: expect.stringContaining('config module exploded'),
          },
        });
        expect(calls).toEqual([]);
      });
    });

    describe('the interactive question', () => {
      it('is asked without a default, before the target question, and a yes enters the Prisma 7 path', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt({ [PRISMA7_QUESTION]: true });

        const inputs = await resolveInitInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

        expect(calls[0]).toEqual({ kind: 'confirm', question: PRISMA7_QUESTION, opts: undefined });
        expect(calls.some((call) => call.kind === 'select')).toBe(false);
        expect(inputs.contractSource).toMatchObject({ kind: 'prisma7-schema' });
      });

      it('is asked when only a Prisma 7 config is found, naming the path it declares', async () => {
        writeProjectFile('prisma.config.ts', "export default { schema: 'db/schema.prisma' };\n");
        const { prompt, calls } = scriptedPrompt({
          'prisma.config.ts is a Prisma 7 config. Use the schema it declares (db/schema.prisma) as the Prisma 8 contract source?': false,
          'What database are you using?': 'postgres',
          'How do you want to write your schema?': 'psl',
          'Re-initializing replaces prisma.config.ts with a fresh scaffold, losing anything you wrote in it.': true,
        });

        await resolveInitInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

        expect(calls[0]?.question).toBe(
          'prisma.config.ts is a Prisma 7 config. Use the schema it declares (db/schema.prisma) as the Prisma 8 contract source?',
        );
      });

      it('runs init as today after a no', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt({
          [PRISMA7_QUESTION]: false,
          'What database are you using?': 'mongo',
          'How do you want to write your schema?': 'typescript',
        });

        const inputs = await resolveInitInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

        expect(calls.map((call) => call.kind)).toEqual(['confirm', 'select', 'select', 'text']);
        expect(inputs).toMatchObject({
          target: 'mongo',
          authoring: 'typescript',
          schemaPath: 'src/prisma/contract.ts',
          contractSource: {
            kind: 'starter',
            authoring: 'typescript',
            schemaPath: 'src/prisma/contract.ts',
          },
          sideBySide: null,
        });
      });

      it('runs init as today when the session cannot ask it', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt();

        await expect(
          resolveInitInputs({ cwd: projectDir, flags: flags({ target: 'postgres' }), prompt }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_MISSING_FLAGS',
          meta: { missingFlags: ['authoring'] },
        });
        expect(calls.map((call) => call.question)).toEqual([
          PRISMA7_QUESTION,
          'How do you want to write your schema?',
        ]);
      });

      it('names --from-prisma7-schema in the missing-flags error of a non-interactive run', async () => {
        writePrisma7Schema();
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInitInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_MISSING_FLAGS',
          why: expect.stringContaining('`--from-prisma7-schema prisma/schema.prisma`'),
          meta: {
            missingFlags: ['target', 'authoring'],
            prisma7SchemaPath: 'prisma/schema.prisma',
          },
        });
      });

      it('is not asked when --authoring or --schema-path is given', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt();

        await resolveInitInputs({
          cwd: projectDir,
          flags: flags({ target: 'postgres', authoring: 'psl' }),
          prompt,
        });

        expect(calls.map((call) => call.question)).not.toContain(PRISMA7_QUESTION);
      });

      it('is not asked when nothing Prisma 7 is found', async () => {
        writeProjectFile('prisma/schema.prisma', 'model User {\n  id String @id\n}\n');
        const { prompt, calls } = scriptedPrompt({
          'What database are you using?': 'postgres',
          'How do you want to write your schema?': 'psl',
        });

        await resolveInitInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

        expect(calls[0]?.kind).toBe('select');
      });
    });

    describe('the side-by-side consent', () => {
      const prisma7Flags = () => flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' });

      it('is asked under the directory token when an earlier prisma is declared, and a yes plans the moves', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', PRISMA7_CONFIG);
        writeManifest({
          name: 'app',
          devDependencies: { prisma: '^7.3.0' },
          dependencies: { '@prisma/client': '^7.3.0' },
        });
        const question = `${SIDE_BY_SIDE_QUESTION.slice(0, -1)}, and rename prisma.config.ts to prisma7.config.ts?`;
        const { prompt, calls } = scriptedPrompt({ [question]: true });

        const inputs = await resolveInitInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(calls.filter((call) => call.kind === 'consent')).toEqual([
          { kind: 'consent', question, opts: { token: basename(projectDir) } },
        ]);
        expect(inputs.sideBySide).toEqual({
          renameConfig: { from: 'prisma.config.ts', extension: 'ts' },
          movePackages: { cliVersion: '^7.3.0', clientVersion: '^7.3.0' },
        });
      });

      it('aborts when declined', async () => {
        writePrisma7Schema();
        writeManifest({ name: 'app', devDependencies: { prisma: '^7.3.0' } });
        const { prompt } = scriptedPrompt({ [SIDE_BY_SIDE_QUESTION]: false });

        await expect(
          resolveInitInputs({ cwd: projectDir, flags: prisma7Flags(), prompt }),
        ).rejects.toMatchObject({ code: 'CLI.INIT_USER_ABORTED' });
      });

      it('plans only the rename when @prisma/prisma7 is already declared', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.mts', PRISMA7_CONFIG);
        writeManifest({
          name: 'app',
          devDependencies: { prisma: '^8.0.0', '@prisma/prisma7': '^7.10.0' },
        });
        const { prompt, calls } = scriptedPrompt({
          'prisma.config.mts is a Prisma 7 config. Rename it to prisma7.config.mts so Prisma 8 can write its own?': true,
        });

        const inputs = await resolveInitInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(calls.filter((call) => call.kind === 'consent')).toHaveLength(1);
        expect(inputs.sideBySide).toEqual({
          renameConfig: { from: 'prisma.config.mts', extension: 'mts' },
          movePackages: null,
        });
      });

      it('is not asked when the config is already prisma7.config.* and prisma is at 8', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma7.config.ts', PRISMA7_CONFIG);
        writeManifest({
          name: 'app',
          devDependencies: { prisma: '^8.0.0', '@prisma/prisma7': '^7.10.0' },
        });
        const { prompt, calls } = scriptedPrompt();

        const inputs = await resolveInitInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(calls.filter((call) => call.kind === 'consent')).toEqual([]);
        expect(inputs.sideBySide).toBeNull();
      });
    });

    describe('re-init consent on the Prisma 7 path', () => {
      const prisma7Flags = () => flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' });

      it('names only files init wrote before, never the Prisma 7 schema', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', PRISMA8_CONFIG);
        writeProjectFile('src/prisma/db.ts', '');
        writeProjectFile('prisma-8.md', '');
        const question =
          'Re-initializing replaces prisma.config.ts, src/prisma/db.ts and prisma-8.md with a fresh scaffold, losing anything you wrote in them.';
        const { prompt, calls } = scriptedPrompt({ [question]: true });

        const inputs = await resolveInitInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(calls.filter((call) => call.kind === 'consent')).toEqual([
          { kind: 'consent', question, opts: { token: basename(projectDir) } },
        ]);
        expect(inputs.reinit).toBe(true);
      });

      it('does not count a Prisma 7 prisma.config.ts as a file to replace', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', PRISMA7_CONFIG);
        const question =
          'prisma.config.ts is a Prisma 7 config. Rename it to prisma7.config.ts so Prisma 8 can write its own?';
        const { prompt, calls } = scriptedPrompt({ [question]: true });

        const inputs = await resolveInitInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(
          calls.filter((call) => call.kind === 'consent').map((call) => call.question),
        ).toEqual([question]);
        expect(inputs.reinit).toBe(false);
      });
    });
  },
  timeouts.coldTransformImport,
);
