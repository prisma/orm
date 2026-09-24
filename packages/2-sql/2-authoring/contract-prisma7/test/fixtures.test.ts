import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { basename, dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { postgresSourceContext } from './support';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const update = process.env['UPDATE_PRISMA7_FIXTURES'] === '1';

interface ExpectedDiagnostic {
  readonly code: string;
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
}

function expectedPath(caseName: string, file: string): string {
  return join(fixturesDir, caseName, file);
}

function compareOrWrite(path: string, actual: unknown): void {
  if (update) {
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  if (!existsSync(path)) {
    throw new Error(
      `Missing expected file ${path}. Review the output, then run with UPDATE_PRISMA7_FIXTURES=1 to write it.`,
    );
  }
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(actual);
}

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('Prisma 7 fixtures', () => {
  it('has a case per rule row', () => {
    expect(cases).toEqual([
      'datetime-defaults',
      'dbgenerated-without-expression',
      'dbgenerated-without-expression-optional',
      'defaults',
      'enum-default-member',
      'enum-default-quoted-string',
      'enum-namespace-mismatch',
      'enum-native',
      'explicit-relations',
      'generator-optional',
      'generators',
      'ignore',
      'ignored-field-in-key',
      'ignored-field-in-references',
      'ignored-field-in-relation',
      'ignored-id-in-implicit-many-to-many',
      'ignored-relation-back-relations',
      'implicit-many-to-many',
      'index-argument-unsupported',
      'indexes',
      'integer-default-not-whole-number',
      'json-null-default',
      'junction-composite-id',
      'junction-name-collision',
      'junction-name-in-other-schema',
      'junction-table-collision',
      'junction-table-name-in-other-schema',
      'keys',
      'list-defaults',
      'long-names',
      'multi-file',
      'multi-file-duplicate',
      'multi-file-errors',
      'multi-file-nested',
      'multi-file-relation-unresolved',
      'multi-schema',
      'naming',
      'native-type-model-ignored',
      'native-type-rejected-bit',
      'native-type-rejected-citext',
      'native-type-rejected-defaults',
      'native-type-rejected-money',
      'native-type-rejected-oid',
      'native-type-rejected-uses',
      'native-type-rejected-varbit',
      'native-type-rejected-xml',
      'native-types-accepted',
      'native-types-without-arguments',
      'number-default-spellings',
      'number-defaults',
      'preview-features-ignored',
      'provider-mismatch',
      'provider-missing',
      'referential-action-defaults',
      'referential-action-not-null',
      'referential-action-not-null-variants',
      'referential-integrity',
      'relation-ambiguous',
      'relation-argument-invalid',
      'relation-mode',
      'relation-name-in-two-schemas',
      'relation-name-shared',
      'relation-nullability',
      'relation-unresolved',
      'relations-ignored',
      'scalars',
      'table-collision',
      'unknown-attribute',
      'unknown-default',
      'unsupported-type',
      'unsupported-type-model-ignored',
      'updated-at',
      'updated-at-optional',
      'updated-at-with-default',
      'updated-at-without-generator',
      'view',
      'view-attributed-fields',
    ]);
  });

  for (const caseName of cases) {
    it(caseName, async () => {
      const directory = join(fixturesDir, caseName, 'schema');
      const schemaPath = existsSync(directory)
        ? directory
        : join(fixturesDir, caseName, 'schema.prisma');
      const config = prisma7Contract(schemaPath, { binding: prisma7PostgresBinding });
      const result = await config.source.load(postgresSourceContext([schemaPath]));
      const diagnosticsPath = expectedPath(caseName, 'expected-diagnostics.json');
      const contractPath = expectedPath(caseName, 'expected-contract.json');

      if (result.ok) {
        expect(existsSync(diagnosticsPath)).toBe(false);
        const serializer = new PostgresContractSerializer();
        const serialized: unknown = JSON.parse(
          JSON.stringify(serializer.serializeContract(result.value as Contract<SqlStorage>)),
        );
        // The full SQL validator with the Postgres entity kinds registered, as
        // `contract emit` and `db verify` run it.
        expect(() => serializer.deserializeContract(serialized)).not.toThrow();
        compareOrWrite(contractPath, serialized);
        return;
      }

      expect(existsSync(contractPath)).toBe(false);
      const diagnostics: ExpectedDiagnostic[] = result.failure.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        file: basename(diagnostic.sourceId ?? ''),
        line: diagnostic.span?.start.line,
        message: diagnostic.message,
      }));
      expect(diagnostics.length).toBeGreaterThan(0);
      compareOrWrite(diagnosticsPath, diagnostics);
    });
  }
});
