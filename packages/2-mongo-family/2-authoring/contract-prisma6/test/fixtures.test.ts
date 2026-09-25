import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { fixturesDir, loadPrisma6Schema, serializeMongoContract } from './support';

const CASES: readonly string[] = [
  'composite-id',
  'composite-index-path',
  'composite-index-path-parse-error',
  'composite-map-unsupported',
  'composite-types',
  'default-unsupported',
  'duplicate-declaration',
  'enums',
  'fulltext',
  'generator-ignored',
  'id-not-objectid',
  'ignore',
  'ignored-field-referenced',
  'index-argument-unsupported',
  'indexes',
  'list-relation-unsupported',
  'lists',
  'missing-id',
  'multi-file',
  'naming',
  'native-type-unsupported',
  'optional-generated-field',
  'provider-mismatch',
  'provider-missing',
  'referential-action-unsupported',
  'relation-argument-invalid',
  'relations',
  'relations-unresolved',
  'scalars',
  'schema-read-failed',
  'schema-unsupported',
  'text-index-limit',
  'timestamps',
  'unknown-attribute',
  'unknown-top-level-block',
  'unsupported-type',
  'unsupported-type-model-ignored',
  'updated-at-type-unsupported',
  'view',
];

const update = process.env['UPDATE_PRISMA6_FIXTURES'] === '1';

interface ExpectedDiagnostic {
  readonly code: string;
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
}

function compareOrWrite(path: string, actual: unknown): void {
  if (update) {
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  if (!existsSync(path)) {
    throw new Error(
      `Missing expected file ${path}. Review the output, then run with UPDATE_PRISMA6_FIXTURES=1 to write it.`,
    );
  }
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(actual);
}

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('Prisma 6 MongoDB fixtures', () => {
  it('has a case per rule row and error code', () => {
    expect(cases).toEqual(CASES);
  });

  for (const caseName of cases) {
    it(caseName, async () => {
      const directory = join(fixturesDir, caseName, 'schema');
      const schemaPath = existsSync(directory)
        ? directory
        : join(fixturesDir, caseName, 'schema.prisma');
      const result = await loadPrisma6Schema(schemaPath);
      const diagnosticsPath = join(fixturesDir, caseName, 'expected-diagnostics.json');
      const contractPath = join(fixturesDir, caseName, 'expected-contract.json');

      if (result.ok) {
        expect(existsSync(diagnosticsPath)).toBe(false);
        compareOrWrite(contractPath, serializeMongoContract(result.value));
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
