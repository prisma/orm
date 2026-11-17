import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  fixturesDir,
  fixtureTree,
  readTree,
  removeWorkDirs,
  runScript,
} from './test-helpers';

afterAll(removeWorkDirs);

const REFUSED_HASH = 'd2fa6ca0dd51a39ed502260d7d69f58343ef0b8c7d080c7885a35fa252fe99e7';
const REPLACED_HASH = 'a999786aa6cf78a5930731256ba2125153d5a33f344d5cb7ac96af664e181b4f';
const TIME_REASON = (value: string) =>
  `pg/time JSON value must be a time of day, as in "12:34:56": "${value}" has 7 digits after the decimal point, but pg/time holds microseconds, so at most 6. Round it, as in "12:34:56.123456".`;
const CONTRACT_FILES = [
  `migrations/snapshots/${REFUSED_HASH}/contract.json`,
  'src/prisma/contract.json',
] as const;

interface ExtensionForm {
  readonly dataType: string;
  readonly typeParams: Record<string, unknown>;
  readonly value: unknown;
  readonly stored?: unknown;
  readonly refused?: string;
}

const extensionForms: readonly ExtensionForm[] = JSON.parse(
  readFileSync(join(fixturesDir, 'extension-default-forms/rc19-forms.json'), 'utf8'),
).columns;

type Columns = Record<string, { default: { value: unknown } }>;

function sampleColumns(text: string): Columns {
  return JSON.parse(text).storage.namespaces.public.entries.table.sample.columns;
}

function defaultsOf(columns: Columns): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(columns).map(([name, column]) => [name, column.default.value]),
  );
}

function withSampleColumns(path: string, columns: Record<string, unknown>): void {
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  contract.storage.namespaces.public.entries.table.sample.columns = columns;
  writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`);
}

function refusal(file: string, table: string, column: string, reason: string): string {
  return `${file}: namespace public, table ${table}, column ${column}: ${reason}; choose the value the database stores and run the script again with --default 'public.${table}.${column}=<that value as JSON>'`;
}

describe('remove-nocheck defaults this release refuses', () => {
  it('stops on a refused default, names the --default that replaces it, and changes nothing', () => {
    const root = copyFixture('before', 'postgres-default-not-a-value');
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr: `${CONTRACT_FILES.map((file) =>
        refusal(
          file,
          'product',
          'opensAt',
          `the default "12:34:00.1234567" is not a value of pg/time (${TIME_REASON('12:34:00.1234567')})`,
        ),
      ).join('\n')}\n`,
      tree: fixtureTree('before', 'postgres-default-not-a-value'),
    });
  });

  it('stores the value given with --default in every contract that holds the refused default, and a second run changes nothing', () => {
    const root = copyFixture('before', 'postgres-default-not-a-value');
    const replaced = runScript(root, undefined, [
      '--default',
      'public.product.opensAt="12:34:00.123457"',
    ]);
    const after = readTree(root);
    const again = runScript(root);
    const snapshot = JSON.parse(
      after[`migrations/snapshots/${REPLACED_HASH}/contract.json`] ?? '{}',
    );
    const emitted = JSON.parse(after['src/prisma/contract.json'] ?? '{}');
    const migration = JSON.parse(after['migrations/app/20261023T0907_init/migration.json'] ?? '{}');
    expect({
      replaced: { status: replaced.status, stdout: replaced.stdout, stderr: replaced.stderr },
      after,
      again: { status: again.status, stdout: again.stdout, stderr: again.stderr },
      unchanged: readTree(root),
      hashes: [snapshot.storage.storageHash, emitted.storage.storageHash, migration.to],
      defaults: [snapshot, emitted].map(
        (contract) =>
          contract.storage.namespaces.public.entries.table.product.columns.opensAt.default.value,
      ),
    }).toEqual({
      replaced: {
        status: 0,
        stdout: [
          'Rewrote 4 files and renamed 1 snapshot directory. Storage hashes changed (old -> new):',
          `  ${REFUSED_HASH} -> ${REPLACED_HASH}`,
          '',
        ].join('\n'),
        stderr: '',
      },
      after: fixtureTree('after', 'postgres-default-not-a-value'),
      again: {
        status: 0,
        stdout: 'No contract stores a noCheck key or a default in another form; nothing changed.\n',
        stderr: '',
      },
      unchanged: fixtureTree('after', 'postgres-default-not-a-value'),
      hashes: [REPLACED_HASH, REPLACED_HASH, REPLACED_HASH],
      defaults: ['12:34:00.123457', '12:34:00.123457'],
    });
  });

  it('refuses a --default value that this release refuses too, and changes nothing', () => {
    const root = copyFixture('before', 'postgres-default-not-a-value');
    const run = runScript(root, undefined, [
      '--default',
      'public.product.opensAt="12:34:00.1234568"',
    ]);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 1,
      stderr: `${CONTRACT_FILES.map(
        (file) =>
          `${file}: namespace public, table product, column opensAt: --default public.product.opensAt: the default "12:34:00.1234568" is not a value of pg/time (${TIME_REASON('12:34:00.1234568')})`,
      ).join('\n')}\n`,
      tree: fixtureTree('before', 'postgres-default-not-a-value'),
    });
  });

  it('refuses a --default for a column whose default it does not refuse, and changes nothing', () => {
    const root = copyFixture('before', 'postgres-defaults');
    const run = runScript(root, undefined, ['--default', 'public.product.price="1.50"']);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr:
        '--default public.product.price: no stored contract has a default of this column that this release refuses, so the script replaces nothing\n',
      tree: fixtureTree('before', 'postgres-defaults'),
    });
  });

  it('refuses a --default without a column and a JSON value', () => {
    const root = copyFixture('before', 'postgres-default-not-a-value');
    const runs = [
      ['--default', 'opensAt'],
      ['--default=public.product.opensAt=12:34'],
      ['--default'],
    ].map((args) => {
      const { status, stderr } = runScript(root, undefined, args);
      return { status, stderr };
    });
    const usage =
      'Usage: node remove-nocheck.ts [project-root] [--default <namespace>.<table>.<column>=<JSON value>]...\n';
    expect({ runs, tree: readTree(root) }).toEqual({
      runs: [
        {
          status: 1,
          stderr: `--default opensAt: expected <namespace>.<table>.<column>=<JSON value>\n${usage}`,
        },
        {
          status: 1,
          stderr: `--default public.product.opensAt=12:34: expected <namespace>.<table>.<column>=<JSON value>\n${usage}`,
        },
        {
          status: 1,
          stderr: `--default: expected <namespace>.<table>.<column>=<JSON value>\n${usage}`,
        },
      ],
      tree: fixtureTree('before', 'postgres-default-not-a-value'),
    });
  });
});

describe('remove-nocheck extension data types', () => {
  it('holds in the before fixture each value rc.19 accepts', () => {
    expect(
      Object.values(
        defaultsOf(
          sampleColumns(
            fixtureTree('before', 'extension-default-forms')['prisma/contract.json'] ?? '{}',
          ),
        ),
      ),
    ).toEqual(
      extensionForms.filter((form) => form.refused === undefined).map(({ value }) => value),
    );
  });

  it('writes postgis/geometry and pgvector/vector defaults in the form rc.19 stores', () => {
    const run = runScript(copyFixture('before', 'extension-default-forms'));
    const tree = readTree(run.root);
    expect({
      status: run.status,
      stderr: run.stderr,
      tree,
      defaults: Object.values(defaultsOf(sampleColumns(tree['prisma/contract.json'] ?? '{}'))),
    }).toEqual({
      status: 0,
      stderr: '',
      tree: fixtureTree('after', 'extension-default-forms'),
      defaults: extensionForms
        .filter((form) => form.refused === undefined)
        .map(({ stored }) => stored),
    });
  });

  it('stops on each postgis/geometry and pgvector/vector default rc.19 refuses, with rc.19 reason, and changes nothing', () => {
    const root = copyFixture('before', 'extension-default-forms');
    const refused = extensionForms.filter((form) => form.refused !== undefined);
    withSampleColumns(
      join(root, 'prisma/contract.json'),
      Object.fromEntries(
        refused.map(({ dataType, typeParams, value }, index) => [
          `r${String(index).padStart(2, '0')}`,
          { dataType, default: { kind: 'literal', value }, nullable: false, typeParams },
        ]),
      ),
    );
    const before = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 1,
      stderr: `${refused
        .map(({ dataType, value, refused: reason }, index) =>
          refusal(
            'prisma/contract.json',
            'sample',
            `r${String(index).padStart(2, '0')}`,
            `the default ${JSON.stringify(value)} is not a value of ${dataType} (${reason})`,
          ),
        )
        .join('\n')}\n`,
      tree: before,
    });
  });
});

describe('remove-nocheck list defaults', () => {
  it('treats a column as a list whenever many is present and not false', () => {
    const run = runScript(copyFixture('before', 'list-defaults'));
    const tree = readTree(run.root);
    expect({
      status: run.status,
      stderr: run.stderr,
      tree,
      defaults: defaultsOf(sampleColumns(tree['prisma/contract.json'] ?? '{}')),
    }).toEqual({
      status: 0,
      stderr: '',
      tree: fixtureTree('after', 'list-defaults'),
      defaults: { manyTrue: ['1.50', null], manyEmpty: ['2.50'], manyFalse: '3.50' },
    });
  });

  it('stops on a list column whose default is not a list, and changes nothing', () => {
    const root = copyFixture('before', 'list-defaults');
    const path = join(root, 'prisma/contract.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\[\s*"1\.5",\s*null\s*\]/, '"1.5"'));
    const before = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 1,
      stderr: `${refusal(
        'prisma/contract.json',
        'sample',
        'manyTrue',
        'the default "1.5" is not a list, and the column holds a list of pg/numeric',
      )}\n`,
      tree: before,
    });
  });
});
