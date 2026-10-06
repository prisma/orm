import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  type EngineRunResult,
  runOnEngine,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from '../utils/cli-test-helpers';

const testDir = dirname(fileURLToPath(import.meta.url));
const oldContractPath = join(
  testDir,
  '../fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json',
);
const fixtureSubdir = 'contract-loading';
const valueObjectSchemaPath = join(
  testDir,
  '../fixtures/cli/cli-e2e-test-app/fixtures',
  fixtureSubdir,
  'contract.prisma',
);
const unreachableDatabase = { '{{DB_URL}}': 'postgres://localhost:1/never-connected' };

const commands = [
  ['contract', 'emit'],
  ['db', 'verify'],
  ['db', 'migrate'],
] as const;

/** The code of the error a run settled with, and its summary and reason as one text. */
function settledError(run: EngineRunResult): { readonly code: string; readonly text: string } {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    throw new Error(`the run did not settle as an error: ${run.stderr}`);
  }
  const { code, summary, why } = terminal.envelope.error;
  return { code, text: [summary, why].join('\n') };
}

withTempDir(({ createTempDir }) => {
  function projectReading(configFileName: string, contractJson: string) {
    const project = setupTestDirectoryFromFixtures(
      createTempDir,
      fixtureSubdir,
      configFileName,
      unreachableDatabase,
    );
    writeFileSync(join(project.testDir, 'contract-input.json'), contractJson, 'utf-8');
    writeFileSync(join(project.outputDir, 'contract.json'), contractJson, 'utf-8');
    return project;
  }

  async function emittedWithValueObjectColumn(): Promise<string> {
    const project = setupTestDirectoryFromFixtures(
      createTempDir,
      fixtureSubdir,
      'prisma.config.psl.ts',
      unreachableDatabase,
    );
    copyFileSync(valueObjectSchemaPath, join(project.testDir, 'contract.prisma'));
    const emit = await runOnEngine(project, ['contract', 'emit']);
    expect(emit.exitCode, emit.stderr).toBe(0);
    return readFileSync(join(project.outputDir, 'contract.json'), 'utf-8');
  }

  describe('a contract emitted before columns named their data type', () => {
    it.each(commands)(
      'is refused by %s %s without mentioning an upgrade script',
      async (...argv) => {
        const project = projectReading(
          'prisma.config.json.ts',
          readFileSync(oldContractPath, 'utf-8'),
        );

        const run = await runOnEngine(project, [...argv, '--json']);

        expect(run.exitCode).not.toBe(0);
        const error = settledError(run);
        expect(error.code).toBe('CONTRACT.VALIDATION_FAILED');
        expect(error.text).toContain(
          `storage.namespaces.auth.entries.table.audit_log_entries.columns.created_at.nativeType: contracts no longer store a column's database type name; the column names its data type in "dataType"`,
        );
        expect(error.text).toContain('and 328 more paths (333 in all)');
        expect(error.text).not.toMatch(/upgrade|script/i);
      },
    );
  });

  describe('a contract whose value-object column the stack declares no storage type for', () => {
    it.each(commands)('is refused by %s %s', async (...argv) => {
      const project = projectReading(
        'prisma.config.json.no-value-object-storage.ts',
        await emittedWithValueObjectColumn(),
      );

      const run = await runOnEngine(project, [...argv, '--json']);

      expect(run.exitCode).not.toBe(0);
      const error = settledError(run);
      expect(error.code).toBe('CONTRACT.VALIDATION_FAILED');
      expect(error.text).toContain(
        `storage.namespaces.public.entries.table.User.columns.address: a value-object column needs the stack's value-object storage type, and the stack declares none`,
      );
    });
  });
});
