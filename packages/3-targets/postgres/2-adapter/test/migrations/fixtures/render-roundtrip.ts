import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { coreHash, profileHash } from '@internal/contract/types';
import { storageHashHex } from '@internal/framework-components/control';
import { type SqlNamespaceBase, SqlStorage } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { applicationDomainOf } from '@repo/test-utils';
import { join, resolve } from 'pathe';
import { createTestPostgresControlAdapter } from '../../helpers/test-control-adapter';

export const execFileAsync = promisify(execFile);
export const testAdapter = createTestPostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);
const packageRoot = resolve(import.meta.dirname, '../../..');
export const repoRoot = resolve(packageRoot, '../../../..');
const targetPostgresRoot = resolve(repoRoot, 'packages/3-targets/postgres/1-target');
export const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const targetPostgresMigrationExport = pathToFileURL(
  resolve(targetPostgresRoot, 'src/exports/migration.ts'),
).href;
const relationalCoreContractFreeExport = pathToFileURL(
  resolve(repoRoot, 'packages/2-sql-family/4-lanes/relational-core/src/exports/contract-free.ts'),
).href;
const cliConfigTypesExport = pathToFileURL(
  resolve(repoRoot, 'packages/1-framework/3-tooling/cli/src/exports/config-types.ts'),
).href;
const familySqlControlExport = pathToFileURL(
  resolve(repoRoot, 'packages/2-sql-family/9-family/src/exports/control.ts'),
).href;
const targetPostgresControlExport = pathToFileURL(
  resolve(targetPostgresRoot, 'src/exports/control.ts'),
).href;
const adapterPostgresControlExport = pathToFileURL(
  resolve(packageRoot, 'src/exports/control.ts'),
).href;

/**
 * `MigrationCLI.run` requires a `prisma.config.ts` to assemble a
 * `ControlStack`. Tests have no workspace `node_modules` resolution from
 * `tmpDir`, so we write a bespoke config alongside `migration.ts` whose
 * imports all use absolute `file://` URLs into the live workspace
 * sources. The driver is omitted — the round-trip exercises the
 * serialization path only and never opens a database connection.
 */
export const fixtureConfigSource = [
  `import postgresAdapter from '${adapterPostgresControlExport}';`,
  `import { defineConfig } from '${cliConfigTypesExport}';`,
  `import sql from '${familySqlControlExport}';`,
  `import postgres from '${targetPostgresControlExport}';`,
  '',
  'export default { $prismaConfig: 1, orm: defineConfig({',
  '  family: sql,',
  '  target: postgres,',
  '  adapter: postgresAdapter,',
  "  migrations: { dir: '.' },",
  '}) };',
  '',
].join('\n');

/**
 * Rewrite the bare import the renderer always emits so that running the
 * rendered scaffold from a temp directory (which has no workspace
 * `node_modules` resolution) still reaches the live in-source modules.
 * The renderer pulls both `Migration` (the base class) and
 * `MigrationCLI` (the entrypoint) from the postgres migration facade, so
 * a single rewrite is enough.
 */
export function rewriteImports(tsSource: string): string {
  return tsSource
    .replace("'@internal/postgres/migration'", `'${targetPostgresMigrationExport}'`)
    .replace(
      "'@internal/sql-relational-core/contract-free'",
      `'${relationalCoreContractFreeExport}'`,
    );
}

function snapshotContractJson(
  storageHash: string,
  namespaces: Readonly<Record<string, SqlNamespaceBase>>,
): string {
  const contract = new PostgresContractSerializer().serializeContract({
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('roundtrip'),
    storage: new SqlStorage({ storageHash: coreHash(storageHash), namespaces }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  });
  return JSON.stringify(contract, null, 2);
}

/**
 * Write the deduplicated snapshot-store fixtures the rendered scaffold
 * imports — `snapshots/<hex>/contract.json` (a serialized contract whose
 * `storage.storageHash` the base's derived `describe()` reads, and whose
 * start-contract tables `this.setDefault` reads) and the matching
 * `snapshots/<hex>/contract.ts` type module (`export type Contract`) for
 * each of `meta.to` and (when non-null) `meta.from`. The JSON hashes match
 * `meta` so the derived describe() is consistent with the migration's
 * identity. `SNAPSHOTS_IMPORT_PATH` matches the `snapshotsImportPath` passed
 * to the migration under test, so the rendered import specifiers resolve
 * relative to `migration.ts` at the root of `dir`.
 */
export async function writeContractFixtures(
  dir: string,
  meta: { readonly from: string | null; readonly to: string },
  startNamespaces: Readonly<Record<string, SqlNamespaceBase>> = {},
): Promise<void> {
  const contractType =
    'export type Contract = { readonly storage: { readonly storageHash: string } };\n';
  const writeSnapshot = async (
    storageHash: string,
    namespaces: Readonly<Record<string, SqlNamespaceBase>>,
  ) => {
    const snapshotDir = join(dir, SNAPSHOTS_IMPORT_PATH, storageHashHex(storageHash));
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(
      join(snapshotDir, 'contract.json'),
      snapshotContractJson(storageHash, namespaces),
    );
    await writeFile(join(snapshotDir, 'contract.ts'), contractType);
  };
  await writeSnapshot(meta.to, {});
  if (meta.from !== null) {
    await writeSnapshot(meta.from, startNamespaces);
  }
}

export const SNAPSHOTS_IMPORT_PATH = './snapshots';
export const META = {
  from: '0'.repeat(64),
  to: '1'.repeat(64),
} as const;
