import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';
import {
  flags,
  projectFiles,
  resolveInputs,
  scriptedPrompt,
  stubCheck,
} from './init-prisma7-fixtures';

let projectDir: string;
let installs: number;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma6');
  installs = 0;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const { write, writeManifest } = projectFiles(() => projectDir);

const PRISMA6_SCHEMA = [
  'datasource db {',
  '  provider = "mongodb"',
  '  url      = env("MONGO_URL")',
  '}',
  '',
  'model User {',
  '  id    String @id @default(auto()) @map("_id") @db.ObjectId',
  '  email String @unique',
  '}',
  '',
].join('\n');

const PRISMA6_MANIFEST = {
  name: 'p6-shop',
  dependencies: { '@prisma/client': '^6.19.0' },
  devDependencies: { prisma: '^6.19.0' },
};

const PRISMA_CONFIG = [
  "import 'dotenv/config';",
  "import { definePrismaConfig } from 'prisma/config';",
  "import { defineConfig as ormConfig, prisma6Schema } from '@prisma/orm-mongo/config';",
  '',
  'export default definePrismaConfig({',
  '  orm: ormConfig({',
  "    contract: prisma6Schema('prisma/schema.prisma'),",
  "    db: { connection: process.env['MONGO_URL']! },",
  '  }),',
  '});',
  '',
].join('\n');

const PRISMA6_CONFIG = [
  "import 'dotenv/config';",
  "import { defineConfig } from 'prisma6/config';",
  '',
  "export default defineConfig({ schema: 'prisma/schema.prisma' });",
  '',
].join('\n');

function writePrisma6Project(): void {
  writeManifest(PRISMA6_MANIFEST);
  write('prisma/schema.prisma', PRISMA6_SCHEMA);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected init to stop');
    },
    (error: unknown) => error,
  );
}

describe(
  'init in a Prisma 6 MongoDB project',
  () => {
    it('stops before changing anything and prints the prisma6Schema setup', async () => {
      writePrisma6Project();
      const { prompt, calls } = scriptedPrompt();

      const error = await rejectionOf(
        resolveInputs({ cwd: projectDir, flags: flags(), prompt, packageManager: 'pnpm' }),
      );

      expect(error).toMatchObject({
        code: 'CLI.INIT_PRISMA6_SCHEMA_FOUND',
        message: 'Prisma 6 MongoDB schema found',
        why: 'prisma/schema.prisma is a Prisma 6 MongoDB schema. Prisma 8 can read it as its contract source through prisma6Schema while Prisma 6 keeps running the app, but init does not set that up: both CLIs are published as `prisma`, and the Prisma 6 CLI also reads prisma.config.ts. Nothing was changed. Follow the steps below. Passing --target and --authoring instead sets up a Prisma 8 starter in this same project, which breaks the Prisma 6 CLI: it writes prisma.config.ts, so every Prisma 6 command fails until Prisma 6 gets its own config file, and its install step replaces the Prisma 6 CLI with prisma@latest.',
        nextActions: [
          {
            kind: 'edit-file',
            label:
              'In package.json, keep the Prisma 6 CLI under another name: replace the "prisma" dev dependency with "prisma6": "npm:prisma@^6.19.0", add the script "prisma6": "node node_modules/prisma6/build/index.js --config prisma6.config.ts", and run every Prisma 6 command through it, as in `pnpm prisma6 db push` and `pnpm prisma6 generate`.',
          },
          {
            kind: 'edit-file',
            label: `Write prisma6.config.ts for the Prisma 6 CLI:\n${PRISMA6_CONFIG.trimEnd()}`,
          },
          {
            kind: 'run-command',
            label: 'Install the Prisma 8 packages',
            command: 'pnpm add @prisma/orm-mongo dotenv mongodb',
          },
          {
            kind: 'run-command',
            label: 'Install the Prisma 8 CLI, which now takes the name prisma',
            command: 'pnpm add -D prisma@latest',
          },
          {
            kind: 'edit-file',
            label: `Write prisma.config.ts for Prisma 8:\n${PRISMA_CONFIG.trimEnd()}`,
          },
          {
            kind: 'run-command',
            label: 'Read the Prisma 6 schema into a contract',
            command: 'prisma contract emit',
          },
          {
            kind: 'run-command',
            label: 'Sign the database the Prisma 6 app uses',
            command: 'prisma db sign',
          },
        ],
        meta: {
          schemaPath: 'prisma/schema.prisma',
          prismaConfig: PRISMA_CONFIG,
          prisma6Config: PRISMA6_CONFIG,
        },
      });
      expect(JSON.stringify(error)).not.toContain('prisma7');
      expect(calls).toEqual([]);
    });

    it('stops the same way for --from-prisma7-schema, before installing anything to check it', async () => {
      writePrisma6Project();
      const { prompt } = scriptedPrompt();
      const check = stubCheck();

      const error = await rejectionOf(
        resolveInputs({
          cwd: projectDir,
          flags: flags({ fromPrisma7Schema: 'prisma/schema.prisma' }),
          prompt,
          checkPrisma7Source: check,
          packageManager: 'npm',
        }),
      );

      expect(error).toMatchObject({ code: 'CLI.INIT_PRISMA6_SCHEMA_FOUND' });
      expect(check.requests).toEqual([]);
    });

    it('finds a Prisma 6 schema that package.json names', async () => {
      writeManifest({ ...PRISMA6_MANIFEST, prisma: { schema: 'db/schema.prisma' } });
      write('db/schema.prisma', PRISMA6_SCHEMA);
      const { prompt } = scriptedPrompt();

      const error = await rejectionOf(
        resolveInputs({ cwd: projectDir, flags: flags(), prompt, packageManager: 'pnpm' }),
      );

      expect(error).toMatchObject({
        code: 'CLI.INIT_PRISMA6_SCHEMA_FOUND',
        meta: { schemaPath: 'db/schema.prisma' },
      });
    });

    it('aliases the Prisma 6 line when the project declares no Prisma 6 CLI', async () => {
      writeManifest({ name: 'p6-shop', dependencies: { '@prisma/client': '^6.19.0' } });
      write('prisma/schema.prisma', PRISMA6_SCHEMA);
      const { prompt } = scriptedPrompt();

      const error = await rejectionOf(
        resolveInputs({ cwd: projectDir, flags: flags(), prompt, packageManager: 'pnpm' }),
      );

      expect(error).toMatchObject({
        code: 'CLI.INIT_PRISMA6_SCHEMA_FOUND',
        nextActions: expect.arrayContaining([
          {
            kind: 'edit-file',
            label:
              'In package.json, install the Prisma 6 CLI under another name: add the dev dependency "prisma6": "npm:prisma@6", add the script "prisma6": "node node_modules/prisma6/build/index.js --config prisma6.config.ts", and run every Prisma 6 command through it, as in `pnpm prisma6 db push` and `pnpm prisma6 generate`.',
          },
        ]),
      });
    });

    it('finds a multi-file Prisma 6 schema in the prisma/schema folder', async () => {
      writeManifest(PRISMA6_MANIFEST);
      const [datasource, models] = PRISMA6_SCHEMA.split('model User');
      write('prisma/schema/schema.prisma', datasource ?? '');
      write('prisma/schema/user.prisma', `model User${models ?? ''}`);
      const { prompt } = scriptedPrompt();

      const error = await rejectionOf(
        resolveInputs({ cwd: projectDir, flags: flags(), prompt, packageManager: 'pnpm' }),
      );

      expect(error).toMatchObject({
        code: 'CLI.INIT_PRISMA6_SCHEMA_FOUND',
        meta: { schemaPath: 'prisma/schema' },
      });
    });

    it('warns a starter run about a Prisma 6 schema that package.json names', async () => {
      writeManifest({ ...PRISMA6_MANIFEST, prisma: { schema: 'db/schema.prisma' } });
      write('db/schema.prisma', PRISMA6_SCHEMA);
      const { prompt } = scriptedPrompt();

      const inputs = await resolveInputs({
        cwd: projectDir,
        flags: flags({
          target: 'mongodb',
          authoring: 'psl',
          schemaPath: 'src/prisma/contract.prisma',
        }),
        prompt,
        packageManager: 'pnpm',
      });

      expect(inputs.warnings).toEqual([
        expect.stringMatching(/^db\/schema\.prisma is a Prisma 6 MongoDB schema/),
      ]);
    });

    it('tells npm users to pass the command after --', async () => {
      writePrisma6Project();
      const { prompt } = scriptedPrompt();

      const error = await rejectionOf(
        resolveInputs({ cwd: projectDir, flags: flags(), prompt, packageManager: 'npm' }),
      );

      expect(error).toMatchObject({
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            label: expect.stringContaining(
              'as in `npm run prisma6 -- db push` and `npm run prisma6 -- generate`',
            ),
          }),
        ]),
      });
    });

    it('asks for the project’s own Prisma 6 config to be renamed rather than written', async () => {
      writePrisma6Project();
      write('prisma.config.ts', "export default { schema: 'prisma/schema.prisma' };\n");
      const { prompt } = scriptedPrompt();

      const error = await rejectionOf(
        resolveInputs({ cwd: projectDir, flags: flags(), prompt, packageManager: 'pnpm' }),
      );

      expect(error).toMatchObject({
        nextActions: expect.arrayContaining([
          {
            kind: 'edit-file',
            label:
              "Rename prisma.config.ts to prisma6.config.ts and import defineConfig from 'prisma6/config' in it, so that only the Prisma 6 CLI reads it.",
          },
        ]),
        meta: { prisma6Config: null },
      });
    });

    it(
      'warns a starter run that it takes the prisma name and prisma.config.ts from Prisma 6, and keeps the module type',
      async () => {
        writePrisma6Project();
        const runner: PackageManagerRunner = async () => {
          installs += 1;
          return { exitCode: 0, stderr: '' };
        };
        const cli = createTestCli({
          commands: BIN_COMMANDS,
          groups: BIN_GROUPS,
          packageManagerRunner: runner,
        });

        const run = await cli.run(
          ['orm', 'init', '--target', 'mongodb', '--authoring', 'psl', '--skip-install', '--json'],
          { cwd: projectDir },
        );
        const manifest = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));

        expect(run.exitCode).toBe(0);
        expect(manifest).not.toHaveProperty('type');
        expect(run.presented?.data).toMatchObject({
          warnings: expect.arrayContaining([
            'prisma/schema.prisma is a Prisma 6 MongoDB schema, which this run leaves alone, but this run breaks the Prisma 6 CLI: it writes prisma.config.ts, which the Prisma 6 CLI reads too, so every Prisma 6 command fails until Prisma 6 gets its own config file, and its install step replaces the Prisma 6 CLI with prisma@latest. Run `prisma orm init` without --target and --authoring to see how to keep Prisma 6 working and read this schema instead.',
          ]),
        });
        expect(existsSync(join(projectDir, 'prisma/schema.prisma'))).toBe(true);
        expect(installs).toBe(0);
      },
      timeouts.coldTransformImport,
    );
  },
  timeouts.coldTransformImport,
);
