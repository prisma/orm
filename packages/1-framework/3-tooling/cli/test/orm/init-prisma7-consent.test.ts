import { rmSync } from 'node:fs';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { timeouts } from '@repo/test-utils';
import { basename } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestProjectDir } from '../utils/test-project-dir';
import {
  flags,
  PRISMA7_CONFIG,
  PRISMA7_QUESTION,
  PRISMA8_CONFIG,
  projectFiles,
  resolveInputs,
  SIDE_BY_SIDE_QUESTION,
  scriptedPrompt,
  stubCheck,
} from './init-prisma7-fixtures';

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-consent');
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
  'the Prisma 7 path consents',
  () => {
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

        const inputs = await resolveInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

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
          resolveInputs({ cwd: projectDir, flags: prisma7Flags(), prompt }),
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

        const inputs = await resolveInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(calls.filter((call) => call.kind === 'consent')).toHaveLength(1);
        expect(inputs.sideBySide).toEqual({
          renameConfig: { from: 'prisma.config.mts', extension: 'mts' },
          movePackages: null,
        });
        expect(inputs.contractSource).toMatchObject({ prisma7Config: 'prisma7.config.mts' });
      });

      it('is not asked when the config is already prisma7.config.* and prisma is at 8', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma7.config.ts', PRISMA7_CONFIG);
        writeManifest({
          name: 'app',
          devDependencies: { prisma: '^8.0.0', '@prisma/prisma7': '^7.10.0' },
        });
        const { prompt, calls } = scriptedPrompt();

        const inputs = await resolveInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(calls.filter((call) => call.kind === 'consent')).toEqual([]);
        expect(inputs.sideBySide).toBeNull();
        expect(inputs.contractSource).toMatchObject({ prisma7Config: 'prisma7.config.ts' });
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

        const inputs = await resolveInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(calls.filter((call) => call.kind === 'consent')).toEqual([
          { kind: 'consent', question, opts: { token: basename(projectDir) } },
        ]);
        expect(inputs.reinit).toBe(true);
      });

      it("counts init's own prisma.config.ts beside a prisma7.config.ts as a file to replace", async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', PRISMA8_CONFIG);
        writeProjectFile('prisma7.config.ts', PRISMA7_CONFIG);
        writeProjectFile('prisma-8.md', '');
        const question =
          'Re-initializing replaces prisma.config.ts and prisma-8.md with a fresh scaffold, losing anything you wrote in them.';
        const { prompt, calls } = scriptedPrompt({ [question]: true });

        const inputs = await resolveInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(
          calls.filter((call) => call.kind === 'consent').map((call) => call.question),
        ).toEqual([question]);
        expect(inputs.reinit).toBe(true);
      });

      it('does not count a Prisma 7 prisma.config.ts as a file to replace', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', PRISMA7_CONFIG);
        const question =
          'prisma.config.ts is a Prisma 7 config. Rename it to prisma7.config.ts so Prisma 8 can write its own?';
        const { prompt, calls } = scriptedPrompt({ [question]: true });

        const inputs = await resolveInputs({ cwd: projectDir, flags: prisma7Flags(), prompt });

        expect(
          calls.filter((call) => call.kind === 'consent').map((call) => call.question),
        ).toEqual([question]);
        expect(inputs.reinit).toBe(false);
      });
    });
    describe('the check that the target package reads the schema', () => {
      const prisma7Flags = () => flags({ ...NO_FLAGS, fromPrisma7Schema: 'prisma/schema.prisma' });
      const ADDED = {
        packages: ['stub-target-package', 'dotenv'],
        removeCommand: 'pnpm remove stub-target-package dotenv',
      };

      it('runs with the target and schema before any consent is asked', async () => {
        writePrisma7Schema();
        writeProjectFile('prisma.config.ts', PRISMA7_CONFIG);
        writeManifest({ name: 'app', devDependencies: { prisma: '^7.3.0' } });
        const { prompt, calls } = scriptedPrompt();
        const refusal = new Error('refused');
        const check = stubCheck();

        await expect(
          resolveInputs({
            cwd: projectDir,
            flags: prisma7Flags(),
            prompt,
            checkPrisma7Source: async (request) => {
              await check(request);
              throw refusal;
            },
          }),
        ).rejects.toBe(refusal);
        expect(check.requests).toEqual([
          { target: 'postgres', schemaPath: 'prisma/schema.prisma' },
        ]);
        expect(calls).toEqual([]);
      });

      it('adds the installed packages to an error a later prompt raises', async () => {
        writePrisma7Schema();
        writeManifest({ name: 'app', devDependencies: { prisma: '^7.3.0' } });
        const { prompt } = scriptedPrompt();
        const consentRequired = new CliStructuredError('CLI.CONSENT_REQUIRED', 'needs consent', {
          nextActions: [{ kind: 'user-choice', label: 'pass --confirm' }],
          meta: { consentToken: 'app' },
        });

        await expect(
          resolveInputs({
            cwd: projectDir,
            flags: prisma7Flags(),
            prompt: {
              ...prompt,
              consent: async () => {
                throw consentRequired;
              },
            },
            checkPrisma7Source: stubCheck({ installed: ADDED.packages, added: ADDED }),
          }),
        ).rejects.toMatchObject({
          code: 'CLI.CONSENT_REQUIRED',
          nextActions: [
            { kind: 'user-choice', label: 'pass --confirm' },
            {
              kind: 'user-choice',
              label:
                'init added stub-target-package and dotenv to package.json before checking; remove them with `pnpm remove stub-target-package dotenv`.',
            },
          ],
          meta: { consentToken: 'app', packagesAdded: ADDED.packages },
        });
      });

      it('warns about the fresh init before asking its questions', async () => {
        writePrisma7Schema();
        const { prompt, calls } = scriptedPrompt({
          [PRISMA7_QUESTION]: true,
          'How do you want to write your schema?': 'psl',
        });
        const warned: { readonly text: string; readonly promptsSoFar: number }[] = [];

        const inputs = await resolveInputs({
          cwd: projectDir,
          flags: flags(NO_FLAGS),
          prompt,
          checkPrisma7Source: stubCheck({ outcome: 'no-source' }),
          warn: (text) => warned.push({ text, promptsSoFar: calls.length }),
        });

        expect(warned).toEqual([
          {
            text: 'stub-target-package cannot read Prisma 7 schemas, so init sets up a fresh Prisma 8 project instead and leaves prisma/schema.prisma alone.',
            promptsSoFar: 1,
          },
        ]);
        expect(inputs.contractSource.kind).toBe('starter');
        expect(inputs.warnings).toEqual([]);
      });

      it('records what it installed so the install phase skips it', async () => {
        writePrisma7Schema();
        const { prompt } = scriptedPrompt();

        const inputs = await resolveInputs({
          cwd: projectDir,
          flags: prisma7Flags(),
          prompt,
          checkPrisma7Source: stubCheck({
            installed: ADDED.packages,
            added: ADDED,
            warnings: ['from the install'],
          }),
        });

        expect(inputs).toMatchObject({
          preinstalled: ADDED.packages,
          warnings: ['from the install'],
        });
      });
    });
  },
  timeouts.coldTransformImport,
);
