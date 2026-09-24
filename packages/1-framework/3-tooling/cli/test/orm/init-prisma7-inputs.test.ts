import { rmSync } from 'node:fs';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestProjectDir } from '../utils/test-project-dir';
import {
  flags,
  PRISMA7_CONFIG,
  PRISMA7_QUESTION,
  projectFiles,
  resolveInputs,
  scriptedPrompt,
} from './init-prisma7-fixtures';

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-inputs');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const {
  write: writeProjectFile,
  writePrisma7Schema,
  writeManifest,
} = projectFiles(() => projectDir);

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
          resolveInputs({
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

        const inputs = await resolveInputs({
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
            prisma7Config: undefined,
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

        const inputs = await resolveInputs({
          cwd: projectDir,
          flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
          prompt,
        });

        expect(inputs.target).toBe('postgres');
      });

      it('accepts a --target that agrees with the provider', async () => {
        writePrisma7Schema();
        const { prompt } = scriptedPrompt();

        const inputs = await resolveInputs({
          cwd: projectDir,
          flags: flags({
            ...NO_FLAGS,
            target: 'postgresql',
            fromPrisma7Schema: 'prisma/schema.prisma',
          }),
          prompt,
        });

        expect(inputs.target).toBe('postgres');
      });

      it('refuses a --target that disagrees with the provider, before anything is asked', async () => {
        writePrisma7Schema();
        writeManifest({ name: 'app', devDependencies: { prisma: '^7.3.0' } });
        const { prompt, calls } = scriptedPrompt();

        await expect(
          resolveInputs({
            cwd: projectDir,
            flags: flags({
              ...NO_FLAGS,
              target: 'mongodb',
              fromPrisma7Schema: 'prisma/schema.prisma',
            }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_TARGET_MISMATCH',
          why: expect.stringContaining('provider = "postgresql"'),
          meta: { schemaPath: 'prisma/schema.prisma', provider: 'postgresql', target: 'mongodb' },
        });
        expect(calls).toEqual([]);
      });

      it('takes --target when the provider is not a string literal', async () => {
        writeProjectFile(
          'prisma/schema.prisma',
          'datasource db {\n  provider = env("PROVIDER")\n}\n',
        );
        const { prompt } = scriptedPrompt();

        const inputs = await resolveInputs({
          cwd: projectDir,
          flags: flags({
            ...NO_FLAGS,
            target: 'postgres',
            fromPrisma7Schema: 'prisma/schema.prisma',
          }),
          prompt,
        });

        expect(inputs.target).toBe('postgres');
      });

      it('takes a mongodb provider as the Mongo target', async () => {
        writePrisma7Schema('mongodb');
        const { prompt } = scriptedPrompt();

        const inputs = await resolveInputs({
          cwd: projectDir,
          flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
          prompt,
        });

        expect(inputs).toMatchObject({
          target: 'mongo',
          contractSource: { kind: 'prisma7-schema', provider: 'mongodb' },
        });
      });

      it('refuses any other provider and lists the supported ones', async () => {
        writePrisma7Schema('sqlite');
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInputs({
            cwd: projectDir,
            flags: flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED',
          meta: {
            schemaPath: 'prisma/schema.prisma',
            provider: 'sqlite',
            supported: ['postgresql', 'mongodb'],
          },
        });
      });

      it('refuses a provider with no known target even when --target is given', async () => {
        writePrisma7Schema('sqlite');
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInputs({
            cwd: projectDir,
            flags: flags({
              ...NO_FLAGS,
              target: 'postgres',
              fromPrisma7Schema: 'prisma/schema.prisma',
            }),
            prompt,
          }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED',
          fix: expect.not.stringContaining('--target'),
          meta: { provider: 'sqlite' },
        });
      });

      it.each([
        ['has no datasource block', 'model User {\n  id String @id\n}\n', 'no-datasource'],
        ['does not exist', undefined, 'absent'],
      ])('refuses a path that %s', async (_case, content, reason) => {
        if (content !== undefined) writeProjectFile('prisma/schema.prisma', content);
        const { prompt } = scriptedPrompt();

        await expect(
          resolveInputs({
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
          resolveInputs({
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

        const inputs = await resolveInputs({
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
          resolveInputs({
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
          resolveInputs({
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
          resolveInputs({
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

        const inputs = await resolveInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

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

        await resolveInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

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

        const inputs = await resolveInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

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
          resolveInputs({ cwd: projectDir, flags: flags({ target: 'postgres' }), prompt }),
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
          resolveInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt }),
        ).rejects.toMatchObject({
          code: 'CLI.INIT_MISSING_FLAGS',
          why: expect.stringContaining('`--from-prisma7-schema prisma/schema.prisma`'),
          meta: {
            missingFlags: ['target', 'authoring'],
            prisma7SchemaPath: 'prisma/schema.prisma',
          },
        });
      });

      it('is not asked when --target disagrees with the provider', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt({
          'How do you want to write your schema?': 'psl',
        });

        const inputs = await resolveInputs({
          cwd: projectDir,
          flags: flags({ target: 'mongodb' }),
          prompt,
        });

        expect(calls.map((call) => call.question)).not.toContain(PRISMA7_QUESTION);
        expect(inputs).toMatchObject({ target: 'mongo', contractSource: { kind: 'starter' } });
      });

      it('is not asked for a provider with no known target', async () => {
        writePrisma7Schema('sqlite');
        const { prompt, calls } = scriptedPrompt({
          'What database are you using?': 'postgres',
          'How do you want to write your schema?': 'psl',
        });

        await resolveInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

        expect(calls.map((call) => call.question)).not.toContain(PRISMA7_QUESTION);
      });

      it('is not asked when --authoring or --schema-path is given', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt();

        await resolveInputs({
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

        await resolveInputs({ cwd: projectDir, flags: flags(NO_FLAGS), prompt });

        expect(calls[0]?.kind).toBe('select');
      });
    });
  },
  timeouts.coldTransformImport,
);
