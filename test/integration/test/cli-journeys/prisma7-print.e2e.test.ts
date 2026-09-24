/**
 * The user-facing journey for `prisma contract print`: a project whose
 * `prisma.config.ts` points at `prisma7Schema('./schema.prisma')` runs
 * `contract print`, switches its config to the Prisma 8 PSL the command wrote,
 * and emits the same contract, which `db sign` and `db verify` then accept
 * against the database the Prisma 7 SQL built. It runs over the `relations` and
 * `supported-verify` fixtures, whose database is the SQL Prisma 7.10.0
 * generated for the full `supported` schema. The command is not tied to
 * Prisma 7: a PSL source prints too. Two things are refused with exit 2 and no
 * file written: a Prisma 7 schema Prisma 8 cannot read, and an output path
 * that is the schema being read. A contract with a default control policy
 * prints with a warning, and the config the READMEs show for the printed file
 * emits it with the same policy.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  type JourneyContext,
  runContractEmit,
  runContractPrint,
  runDbSign,
  runDbVerify,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRISMA7_FIXTURES = join(__dirname, '../fixtures/prisma7-source');
const JOURNEY_FIXTURES = join(__dirname, '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys');
const REPO_ROOT = join(__dirname, '../../../..');
const READMES_WITH_POLICY_CONFIG = [
  join(REPO_ROOT, 'packages/1-framework/3-tooling/cli/README.md'),
  join(REPO_ROOT, 'packages/3-extensions/postgres/README.md'),
];

/** The published import paths the READMEs use, and the workspace packages that back them. */
const PUBLISHED_TO_WORKSPACE: ReadonlyArray<readonly [string, string]> = [
  ["'prisma/config'", "'@prisma/cli-engine'"],
  ["'@prisma/orm-family-sql/contract-psl/provider'", "'@internal/sql-contract-psl/provider'"],
  ["'@prisma/orm-postgres/config'", "'@internal/postgres/config'"],
  ["'@prisma/orm-postgres/target/", "'@internal/target-postgres/"],
];

/** The \`prisma.config.ts\` block in a README that sets \`defaultControlPolicy\`. */
function policyConfigIn(readmePath: string): string {
  const blocks = [...readFileSync(readmePath, 'utf-8').matchAll(/```typescript\n([\s\S]*?)```/g)];
  const block = blocks
    .map((match) => match[1] ?? '')
    .find((text) => text.includes('defaultControlPolicy'));
  if (block === undefined) {
    throw new Error(`${readmePath} shows no config that sets defaultControlPolicy`);
  }
  return block;
}

function withWorkspaceImports(config: string): string {
  return PUBLISHED_TO_WORKSPACE.reduce(
    (text, [published, workspace]) => text.replaceAll(published, workspace),
    config,
  );
}

function emittedContractJson(testDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(testDir, 'prisma', 'contract.json'), 'utf-8'));
}

const PRISMA7_DDL = readFileSync(join(PRISMA7_FIXTURES, 'supported/migration.sql'), 'utf-8');

const VIEW_SCHEMA = `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}

view ActiveUsers {
  id Int
}
`;

const NO_DATABASE = 'postgres://user:password@localhost:5432/unused';

function writeConfig(testDir: string, fixture: string, connectionString: string): string {
  const config = readFileSync(join(JOURNEY_FIXTURES, fixture), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, fixture);
  writeFileSync(configPath, config, 'utf-8');
  return configPath;
}

function setupPrisma7Project(
  createTempDir: () => string,
  connectionString: string,
  schema: { readonly copyFrom: string } | { readonly text: string },
): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  if ('copyFrom' in schema) {
    copyFileSync(schema.copyFrom, join(testDir, 'schema.prisma'));
  } else {
    writeFileSync(join(testDir, 'schema.prisma'), schema.text, 'utf-8');
  }
  return {
    testDir,
    configPath: writeConfig(testDir, 'prisma.config.prisma7.ts', connectionString),
    outputDir: testDir,
  };
}

/** The same project, read through the Prisma 8 PSL `contract print` wrote. */
function onPrintedContract(ctx: JourneyContext, connectionString: string): JourneyContext {
  return {
    ...ctx,
    configPath: writeConfig(ctx.testDir, 'prisma.config.prisma7-printed.ts', connectionString),
  };
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

function storageHashOf(run: EngineCommandResult): string {
  const data = run.presented?.data;
  if (typeof data !== 'object' || data === null || !('storageHash' in data)) {
    throw new Error('contract emit reported no storage hash');
  }
  const { storageHash } = data;
  if (typeof storageHash !== 'string') {
    throw new Error('contract emit reported a storage hash that is not a string');
  }
  return storageHash;
}

function errorOf(run: EngineCommandResult): { readonly code: string; readonly summary: string } {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    throw new Error('the run did not settle as an error');
  }
  const { code, summary } = terminal.envelope.error;
  return { code, summary };
}

/**
 * Prints, switches the config to the written file, emits, signs, and verifies.
 * The two journeys differ only in the fixture they run over.
 */
async function printAndVerify(ctx: JourneyContext, connectionString: string): Promise<void> {
  const prisma7Emit = await runContractEmit(ctx, ['--json']);
  expect(prisma7Emit.exitCode, `contract emit on the Prisma 7 source\n${output(prisma7Emit)}`).toBe(
    0,
  );

  const print = await runContractPrint(ctx, ['--json']);
  expect(print.exitCode, `contract print\n${output(print)}`).toBe(0);
  expect(print.presented?.data).toMatchObject({
    ok: true,
    psl: { path: 'contract.prisma' },
    source: ['schema.prisma'],
  });

  const written = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
  expect(written.split('\n\n')[0]).toBe(
    '// use prisma-8\n// Printed from schema.prisma by `prisma contract print`.',
  );

  const printed = onPrintedContract(ctx, connectionString);
  const pslEmit = await runContractEmit(printed, ['--json']);
  expect(pslEmit.exitCode, `contract emit on the printed contract\n${output(pslEmit)}`).toBe(0);
  expect(storageHashOf(pslEmit)).toBe(storageHashOf(prisma7Emit));

  const sign = await runDbSign(printed, ['--json']);
  expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

  const verify = await runDbVerify(printed, ['--json']);
  expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
  expect(verify.presented?.data).toMatchObject({
    ok: true,
    mode: 'full',
    schema: { strict: false, warnings: [] },
  });
}

withTempDir(({ createTempDir }) => {
  describe('Journey: printing a Prisma 7 schema and emitting it as Prisma 8', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_DDL)),
    });

    it.each(['relations', 'supported-verify'])(
      'prints the %s fixture and verifies against the database Prisma 7 built',
      async (fixture) => {
        await printAndVerify(
          setupPrisma7Project(createTempDir, db.connectionString, {
            copyFrom: join(PRISMA7_FIXTURES, `${fixture}/schema.prisma`),
          }),
          db.connectionString,
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey: printing a contract with a default control policy', () => {
    it('warns about the policy, and the README config emits the printed file with it', async () => {
      const [cliReadme, ...otherReadmes] = READMES_WITH_POLICY_CONFIG.map(policyConfigIn);
      for (const readme of otherReadmes) {
        expect(readme).toBe(cliReadme);
      }
      const testDir = createTempDir();
      writeProjectManifest(testDir);
      mkdirSync(join(testDir, 'prisma'), { recursive: true });
      copyFileSync(
        join(JOURNEY_FIXTURES, 'contract-default-policy.ts'),
        join(testDir, 'prisma', 'contract.ts'),
      );
      const typeScriptConfig = writeConfig(testDir, 'prisma.config.default-policy.ts', NO_DATABASE);
      writeFileSync(
        join(testDir, 'prisma.config.policy-psl.ts'),
        withWorkspaceImports(cliReadme ?? ''),
        'utf-8',
      );
      const onTypeScript: JourneyContext = {
        testDir,
        configPath: typeScriptConfig,
        outputDir: testDir,
      };
      const onPrinted: JourneyContext = {
        ...onTypeScript,
        configPath: join(testDir, 'prisma.config.policy-psl.ts'),
      };

      const typeScriptEmit = await runContractEmit(onTypeScript, ['--json']);
      expect(typeScriptEmit.exitCode, output(typeScriptEmit)).toBe(0);
      expect(emittedContractJson(testDir)).toMatchObject({ defaultControlPolicy: 'external' });

      const print = await runContractPrint(onTypeScript, ['--json']);
      expect(print.exitCode, output(print)).toBe(0);
      expect(print.presented?.data).toMatchObject({
        psl: { path: 'prisma/contract.prisma' },
        defaultControlPolicy: 'external',
      });
      expect(print.events).toContainEqual(
        expect.objectContaining({
          kind: 'message',
          severity: 'warn',
          text: expect.stringContaining("Set defaultControlPolicy: 'external'"),
        }),
      );

      const printedEmit = await runContractEmit(onPrinted, ['--json']);
      expect(printedEmit.exitCode, output(printedEmit)).toBe(0);
      expect(storageHashOf(printedEmit)).toBe(storageHashOf(typeScriptEmit));
      expect(emittedContractJson(testDir)).toMatchObject({ defaultControlPolicy: 'external' });
    });
  });

  describe('Journey: contract print on other sources, and what it refuses', () => {
    it('prints a PSL source, so the command is not tied to Prisma 7', async () => {
      const ctx = setupPrisma7Project(createTempDir, NO_DATABASE, {
        copyFrom: join(PRISMA7_FIXTURES, 'implicit-many-to-many-names/schema.prisma'),
      });
      writeFileSync(join(ctx.testDir, 'contract.prisma'), 'model User {\n  id Int @id\n}\n');
      const onPsl = onPrintedContract(ctx, NO_DATABASE);

      const print = await runContractPrint(onPsl, ['--output', 'printed.prisma', '--json']);

      expect(print.exitCode, output(print)).toBe(0);
      expect(readFileSync(join(ctx.testDir, 'printed.prisma'), 'utf-8')).toBe(
        '// use prisma-8\n// Printed from contract.prisma by `prisma contract print`.\n\nnamespace public {\n  model User {\n    id Int @id\n  }\n}\n',
      );
    });

    it('reports what the Prisma 7 source reports about a view and writes nothing', async () => {
      const ctx = setupPrisma7Project(createTempDir, NO_DATABASE, { text: VIEW_SCHEMA });

      const print = await runContractPrint(ctx, ['--json']);

      expect(print.exitCode, output(print)).toBe(2);
      expect(errorOf(print).code).toBe('CONTRACT.SOURCE_LOAD_FAILED');
      expect(existsSync(join(ctx.testDir, 'contract.prisma'))).toBe(false);
    });

    it('refuses to write over the schema it reads and leaves that file unchanged', async () => {
      const ctx = setupPrisma7Project(createTempDir, NO_DATABASE, {
        copyFrom: join(PRISMA7_FIXTURES, 'relations/schema.prisma'),
      });
      const schemaPath = join(ctx.testDir, 'schema.prisma');
      const before = readFileSync(schemaPath, 'utf-8');

      const print = await runContractPrint(ctx, ['--output', 'schema.prisma', '--json']);

      expect(print.exitCode, output(print)).toBe(2);
      expect(errorOf(print).code).toBe('CONTRACT.PRINT_OUTPUT_IS_SOURCE');
      expect(readFileSync(schemaPath, 'utf-8')).toBe(before);
      expect(existsSync(join(ctx.testDir, 'contract.prisma'))).toBe(false);
    });
  });
});
