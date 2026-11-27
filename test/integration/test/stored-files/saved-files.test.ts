import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { deserializeMongoOps } from '@internal/target-mongo/control';
import { MysqlContractSerializer } from '@internal/target-mysql/runtime';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { SqliteContractSerializer } from '@internal/target-sqlite/runtime';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../../../..');

const contractReaders: Readonly<Record<string, (json: unknown) => unknown>> = {
  postgres: (json) => new PostgresContractSerializer().deserializeContract(json),
  sqlite: (json) => new SqliteContractSerializer().deserializeContract(json),
  mysql: (json) => new MysqlContractSerializer().deserializeContract(json),
  mariadb: (json) => new MysqlContractSerializer().deserializeContract(json),
  mongo: (json) => new MongoContractSerializer().deserializeContract(json),
};

const upgrade = 'test/integration/test/upgrade-instructions';
const telemetrySnapshots = [
  '269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6',
  '2c0677a6b6e5b60bb328a78d882483d8a00804e00c1e05fba259ff8304882558',
].map((hash) => `migrations/snapshots/${hash}/contract.json`);

/**
 * Saved files that no reader of this release is meant to read, each by name. Every other saved
 * `contract.json` and MongoDB `ops.json` must read, so a new file is never left out by accident.
 */
const notRead: readonly { readonly path: string; readonly why: string }[] = [
  ...[
    'client-takes-contract-value',
    'data-type-in-contract',
    'data-type-values',
    'expand-type-aliases',
    'mongo-field-storage-names',
    'mongo-index-names',
    'remove-nocheck',
    'value-objects-in-storage',
  ].map((script) => ({
    path: `${upgrade}/${script}/`,
    why: 'the fixtures of an earlier upgrade script, in the formats before and after that script',
  })),
  {
    path: `${upgrade}/stored-files-format-version/fixtures/before/`,
    why: 'the files before the format version script, as release candidates wrote them',
  },
  ...telemetrySnapshots.map((file) => ({
    path: `${upgrade}/stored-files-format-version/fixtures/after/app/${file}`,
    why: 'copies of the telemetry backend snapshots below',
  })),
  ...telemetrySnapshots.map((file) => ({
    path: `apps/telemetry-backend/${file}`,
    why: 'snapshots in a contract shape from before 8.0.0-rc.1, which no reader of 8.0 reads',
  })),
  ...[
    'converging-branches',
    'diamond',
    'long-spine',
    'multi-branch',
    'showcase',
    'skip-rollback',
    'wide-fan',
  ].map((graph) => ({
    path: `examples/prisma-8-demo/fixtures/${graph}/`,
    why: 'migration graph examples in a contract shape from before 8.0.0-rc.1 (see gotchas.md)',
  })),
  {
    path: 'packages/2-mongo-family/7-runtime/test/fixtures/contract.json',
    why: 'a type test fixture: only its contract.d.ts is used',
  },
];

function savedFiles(name: string): readonly string[] {
  return execFileSync('git', ['ls-files', `*${name}`], { cwd: repoRoot, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => file.split('/').at(-1) === name)
    .filter((file) => !notRead.some(({ path }) => file.startsWith(path)));
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, file), 'utf8'));
}

function refusalOf(read: () => unknown): string | undefined {
  try {
    read();
    return undefined;
  } catch (error) {
    return String(error instanceof Error ? error.message : error).split('\n')[0];
  }
}

const contractFiles = savedFiles('contract.json');

const mongoOpsFiles = savedFiles('ops.json').filter((file) => {
  const operations = readJson(file);
  return (
    Array.isArray(operations) &&
    operations.length > 0 &&
    operations.every((operation) => !Reflect.has(Object(operation), 'target'))
  );
});

describe('the stored files saved in the repository', () => {
  it(`include ${contractFiles.length} contract.json files, each of which its target reads`, () => {
    const refused = contractFiles.flatMap((file) => {
      const json = readJson(file);
      const target = String(Reflect.get(Object(json), 'target'));
      const read = contractReaders[target];
      const reason =
        read === undefined ? `no reader for target "${target}"` : refusalOf(() => read(json));
      return reason === undefined ? [] : [`${file}: ${reason}`];
    });
    expect(refused).toEqual([]);
    expect(contractFiles.length).toBeGreaterThan(300);
  });

  it(`include ${mongoOpsFiles.length} MongoDB ops.json files, each of which the MongoDB reader reads`, () => {
    const refused = mongoOpsFiles.flatMap((file) => {
      const operations = readJson(file);
      const reason = Array.isArray(operations)
        ? refusalOf(() => deserializeMongoOps(operations))
        : 'not a list of operations';
      return reason === undefined ? [] : [`${file}: ${reason}`];
    });
    expect(refused).toEqual([]);
    expect(mongoOpsFiles.length).toBeGreaterThanOrEqual(10);
  });
});
