#!/usr/bin/env node
/**
 * Regenerates migration metadata for example-app chains that carry on-disk
 * contract snapshots (start-contract / end-contract). Unlike extension-package
 * migrations, example-app migrations form multi-step chains, so the script
 * walks each chain in order and re-derives every contract snapshot from its
 * per-migration PSL source file (`contract.prisma` inside each migration dir).
 *
 * For each migration directory in chain order the script:
 *
 *   1. Writes a temporary `.prisma-regen.config.ts` inside the migration
 *      dir that imports the example's real `prisma.config.ts` and
 *      overrides only the `contract` field to point at the migration's
 *      `contract.prisma`. This keeps `extensions`, `db`, and `family` correct
 *      for every family without any per-family template.
 *   2. Runs `prisma contract emit --config <tmp-config> --output-path <tmp-dir>`
 *      to emit fresh `contract.json` + `contract.d.ts` for that migration's
 *      end state into a scratch directory, then writes them into the
 *      migrations-root-wide content-addressed store
 *      (`migrations/snapshots/<hex>/`, write-if-absent) under the freshly
 *      emitted hash. The predecessor's end state is already in the store
 *      under its own hash (chain order guarantees it was written on the
 *      previous iteration), so there is nothing to copy for the start side.
 *   3. Rewrites the `endContract` / `startContract` (and `Contract as End` /
 *      `Contract as Start`) import specifiers in `migration.ts` to the
 *      store's specifiers for the (possibly new) hashes, keyed on those
 *      fixed import bindings rather than on whatever hex is currently there
 *      — a no-op when the hash hasn't changed since the last regen.
 *   4. Runs `tsx migration.ts` from the example package root to regenerate
 *      `ops.json` + `migration.json`. NOTE: `migration.ts` carries its
 *      operations as a static `override get operations()` getter; this step
 *      SERIALIZES that getter — it does NOT call `MigrationPlanner.plan()`.
 *      So this regen (and `fixtures:check`) does not re-derive or gate planner
 *      output; a planner change is invisible here. Prove planner-op parity via
 *      the planner suites + `migration plan` e2e + a golden diff of real
 *      `plan()` output vs these committed ops. See
 *      `docs/onboarding/fixtures-emit-and-check.md`.
 *   5. Biome-formats the touched JSON files via stdin (bypassing biome's
 *      `files.includes` exclusion globs — same technique as
 *      `regen-extension-migrations.mjs`; see that file's JSDoc for rationale).
 *      The store's `contract.json` is written pre-canonicalized by
 *      `writeContractSnapshot` and is not biome-formatted (its single-line
 *      canonical form is the committed shape).
 *
 * Idempotence: on a second run with no schema changes the emitted contract is
 * byte-identical to the store entry already on disk (write-if-absent is a
 * no-op), so the specifier rewrite is a no-op and the tsx re-run produces no
 * diff.
 *
 * Usage:
 *   node scripts/regen-example-migrations.mjs
 *
 * Adding a new example chain: add an entry to the CHAINS array below.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
} from '@internal/framework-components/control';
import {
  snapshotsImportPathFrom,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const biome = join(repoRoot, 'node_modules', '.bin', 'biome');

/**
 * The workspace modules the temp config below needs, as absolute `file://`
 * URLs into the live sources.
 *
 * Bare specifiers would be resolved from the example the temp config is written
 * into, and an example depends on one published `@prisma/orm-*` package and
 * nothing else — it has no reason to resolve the workspace internals a
 * regeneration script happens to want. Naming the files directly keeps this
 * script's needs out of the examples' dependencies. Same reasoning, and the
 * same shape, as the fixture config in
 * `packages/3-targets/6-adapters/postgres/test/migrations/render-typescript.roundtrip.test.ts`.
 */
const workspaceModule = (relativePath) => pathToFileURL(resolve(repoRoot, relativePath)).href;

const sqlContractPslProvider = workspaceModule(
  'packages/2-sql/2-authoring/contract-psl/src/exports/provider.ts',
);
const mongoContractPslProvider = workspaceModule(
  'packages/2-mongo-family/2-authoring/contract-psl/src/exports/provider.ts',
);
const targetPostgresPack = workspaceModule(
  'packages/3-targets/3-targets/postgres/src/exports/pack.ts',
);
const targetPostgresTypes = workspaceModule(
  'packages/3-targets/3-targets/postgres/src/exports/types.ts',
);
const frameworkConfigTypes = workspaceModule(
  'packages/1-framework/1-core/config/src/exports/config-types.ts',
);

// Some example configs guard against a missing DATABASE_URL at module load time.
// Contract emit and migration serialization don't actually connect to the DB, but
// the config module must be importable. Pass a fallback so those guards don't throw.
const childEnv = {
  ...process.env,
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/postgres',
};

/**
 * One entry per example-app migration chain to regenerate.
 *
 * exampleDir      — path to the example package root, relative to repoRoot.
 * migrationsDir   — path to the namespace chain directory, relative to exampleDir.
 * realConfigPath  — path to the example's real `prisma.config.ts`, relative
 *                   to repoRoot. The temp config imports this and overrides only
 *                   the `contract` field, so `extensions`, `db`, and `family` are
 *                   always correct by construction.
 * contractFamily  — which contract provider to use when overriding the `contract`
 *                   field in the temp config. `'mongo'` uses `mongoContract`;
 *                   `'sql'` uses `prismaContract` together with the postgres
 *                   target pack and namespace factory. Both are named by the
 *                   `workspaceModule` URLs above rather than by package name.
 *                   Defaults to `'mongo'` when omitted (backward-compat shim so
 *                   existing entries without the field continue to work).
 */
const CHAINS = [
  {
    exampleDir: 'examples/retail-store',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/retail-store/prisma.config.ts',
    contractFamily: 'mongo',
  },
  {
    exampleDir: 'examples/mongo-demo',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/mongo-demo/prisma.config.ts',
    contractFamily: 'mongo',
  },
  {
    exampleDir: 'examples/prisma-8-demo',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/prisma-8-demo/prisma.config.ts',
    contractFamily: 'sql',
  },
  {
    exampleDir: 'examples/prisma-8-postgis-demo',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/prisma-8-postgis-demo/prisma.config.ts',
    contractFamily: 'sql',
  },
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Format a file through `biome format --stdin-file-path <basename>` and write
 * the result back in place.
 *
 * Using stdin bypasses biome's `files.includes` exclusion globs (which exclude
 * migration.json, ops.json, end-contract.json, and *.d.ts from the normal
 * check/format pass) while still applying the project's formatter settings
 * (lineWidth, indentStyle, trailing newline, etc.). The result is
 * byte-identical to what biome would produce if the file were not excluded.
 */
function biomeFormatInPlace(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const formatted = execFileSync(biome, ['format', '--stdin-file-path', basename(filePath)], {
    input: content,
    encoding: 'utf8',
    cwd: repoRoot,
  });
  writeFileSync(filePath, formatted, 'utf8');
}

/**
 * Rewrite storage-hash literals (bare lowercase sha-256 hex) in a `migration.ts` file.
 *
 * `newFromHash` is null for baseline migrations (whose `from:` is `null`).
 * For non-baseline migrations both `from:` and `to:` are updated.
 *
 * New-shape migrations (post TML-2892) carry no hash literals: they import the
 * committed `end-contract.json` / `start-contract.json` and the `Migration` base
 * derives `describe()`'s from/to from those JSONs' `storage.storageHash`. The
 * regen pipeline re-emits those contract JSONs upstream of this call, so for the
 * new shape there is nothing to rewrite here — the correct hashes already live
 * in the regenerated JSON. Detect that shape (`endContractJson = endContract`
 * with no `to: '<hex>'` literal) and skip the rewrite.
 *
 * Returns true if the file was changed, false if the hashes were already
 * up-to-date (or the file is the new contract-JSON shape).
 */
function rewriteMigrationHashes(migrationTsPath, newFromHash, newToHash) {
  const src = readFileSync(migrationTsPath, 'utf8');

  const toPattern = /(to:\s*['"])(?:[0-9a-f]{64}|empty)(['"])/g;
  const isContractJsonShape =
    src.includes('endContractJson = endContract') && [...src.matchAll(toPattern)].length === 0;
  if (isContractJsonShape) {
    // The from/to identity is derived by the base from the (already-regenerated)
    // contract JSON; no literal to rewrite in migration.ts.
    return false;
  }

  let updated = src;

  if (newFromHash !== null) {
    const fromPattern = /(from:\s*['"])(?:[0-9a-f]{64}|empty)(['"])/g;
    const fromMatches = [...src.matchAll(fromPattern)];
    if (fromMatches.length === 0) {
      throw new Error(`regen-example-migrations: no 'from: <hash>' literal in ${migrationTsPath}`);
    }
    if (fromMatches.length > 1) {
      throw new Error(
        `regen-example-migrations: ${fromMatches.length} 'from: <hash>' literals in ${migrationTsPath}; expected 1`,
      );
    }
    updated = updated.replace(fromPattern, `$1${newFromHash}$2`);
  }

  const toMatches = [...updated.matchAll(toPattern)];
  if (toMatches.length === 0) {
    throw new Error(`regen-example-migrations: no 'to: <hash>' literal in ${migrationTsPath}`);
  }
  if (toMatches.length > 1) {
    throw new Error(
      `regen-example-migrations: ${toMatches.length} 'to: <hash>' literals in ${migrationTsPath}; expected 1`,
    );
  }
  updated = updated.replace(toPattern, `$1${newToHash}$2`);

  if (updated === src) {
    return false;
  }
  writeFileSync(migrationTsPath, updated, 'utf8');
  return true;
}

/**
 * Rewrite the store specifiers in a migration.ts's contract import block —
 * `endContract` / `Contract as End` always, `startContract` /
 * `Contract as Start` when `fromHash` is non-null — to point at the
 * freshly-emitted hashes. Keyed on the fixed import bindings the renderers
 * always emit rather than on whatever hex the specifier currently encodes,
 * so it is idempotent regardless of the previous hash.
 */
function rewriteContractSnapshotSpecifiers(source, snapshotsImportPath, toHash, fromHash) {
  let updated = source
    .replace(
      /(import\s+endContract\s+from\s+')[^']*(')/,
      `$1${contractSnapshotJsonSpecifier(snapshotsImportPath, toHash)}$2`,
    )
    .replace(
      /(import\s+type\s*\{\s*Contract\s+as\s+End\s*\}\s+from\s+')[^']*(')/,
      `$1${contractSnapshotTypesSpecifier(snapshotsImportPath, toHash)}$2`,
    );

  if (fromHash !== null) {
    updated = updated
      .replace(
        /(import\s+startContract\s+from\s+')[^']*(')/,
        `$1${contractSnapshotJsonSpecifier(snapshotsImportPath, fromHash)}$2`,
      )
      .replace(
        /(import\s+type\s*\{\s*Contract\s+as\s+Start\s*\}\s+from\s+')[^']*(')/,
        `$1${contractSnapshotTypesSpecifier(snapshotsImportPath, fromHash)}$2`,
      );
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Per-migration and per-chain logic
// ---------------------------------------------------------------------------

/**
 * Build the TypeScript source for the temporary regen config.
 *
 * For mongo chains the override uses `mongoContract(schemaPath)`.
 * For sql chains it uses `prismaContract(schemaPath, { target, createNamespace })`
 * — the same options the postgres `defineConfig` helper passes — so the emitted
 * contract is identical in shape to what the real config would produce.
 *
 * The result is passed through `defineConfig` so the export carries the
 * config-format version marker the loader requires. Spreading `realConfig`
 * drops that marker (it is non-enumerable), so re-stamping here is required.
 *
 * @param {string} schemaSrc        - Absolute path to the migration's contract.prisma.
 * @param {string} realConfigAbsPath - Absolute path to the example's real config file.
 * @param {'mongo'|'sql'} contractFamily - Which provider to use.
 * @returns {string} TypeScript source for the temp config.
 */
function buildTempConfigSource(schemaSrc, realConfigAbsPath, contractFamily) {
  if (contractFamily === 'sql') {
    return (
      `import { defineConfig as engineDefineConfig } from '@prisma/cli-engine';\n` +
      `import { defineConfig } from '${frameworkConfigTypes}';\n` +
      `import { prismaContract } from '${sqlContractPslProvider}';\n` +
      `import postgresPackRef from '${targetPostgresPack}';\n` +
      `import { postgresCreateNamespace } from '${targetPostgresTypes}';\n` +
      `import realConfig from '${realConfigAbsPath}';\n\n` +
      'export default engineDefineConfig({\n' +
      '  orm: defineConfig({\n' +
      '    ...realConfig.orm,\n' +
      `    contract: prismaContract('${schemaSrc}', {\n` +
      '      target: postgresPackRef,\n' +
      '      createNamespace: postgresCreateNamespace,\n' +
      '    }),\n' +
      '  }),\n' +
      '});\n'
    );
  }
  // Default: mongo
  return (
    `import { defineConfig as engineDefineConfig } from '@prisma/cli-engine';\n` +
    `import { defineConfig } from '${frameworkConfigTypes}';\n` +
    `import { mongoContract } from '${mongoContractPslProvider}';\n` +
    `import realConfig from '${realConfigAbsPath}';\n\n` +
    'export default engineDefineConfig({\n' +
    '  orm: defineConfig({\n' +
    '    ...realConfig.orm,\n' +
    `    contract: mongoContract('${schemaSrc}'),\n` +
    '  }),\n' +
    '});\n'
  );
}

/**
 * Emit the contract from a migration dir's `contract.prisma` into a scratch
 * directory and read the result back.
 *
 * A temporary config file is written into `migrationDir`, used for the emit
 * call, and deleted immediately after. It imports the example's real
 * `prisma.config.ts` and overrides only the `contract` field to point at
 * the migration's `contract.prisma` (using an absolute path so resolution is
 * independent of where the temp file sits). All other config (extensions, db,
 * family) comes from the real config unchanged.
 *
 * The emit target is a fresh `mkdtemp` directory rather than `migrationDir`
 * itself: the migration package directory no longer carries a contract copy
 * of its own (it resolves via the store), so the emitted `contract.json` /
 * `contract.d.ts` are read into memory and the scratch directory is removed
 * before returning.
 *
 * Returns `{ storageHash, contractJson, contractDts }`.
 */
function emitMigrationContract(exampleDir, migrationDir, realConfigAbsPath, contractFamily) {
  // The workspace root carries the local prisma bin (examples name no
  // @internal/* package, per lint:consumer-internal-imports).
  const prismaBin = join(repoRoot, 'node_modules', '.bin', 'prisma');
  if (!existsSync(prismaBin)) {
    throw new Error(
      `regen-example-migrations: prisma bin not found at ${prismaBin}; run pnpm install`,
    );
  }

  const schemaSrc = join(migrationDir, 'contract.prisma');
  if (!existsSync(schemaSrc)) {
    throw new Error(
      `regen-example-migrations: no contract.prisma in ${migrationDir}. ` +
        'Each migration directory must contain a contract.prisma for its end state.',
    );
  }

  // The temp config imports the example's real config and overrides only the
  // contract path. Absolute paths for both imports ensure resolution is
  // independent of the temp file's location.
  const tmpConfigPath = join(migrationDir, '.prisma-regen.config.ts');
  const tmpConfig = buildTempConfigSource(schemaSrc, realConfigAbsPath, contractFamily ?? 'mongo');
  writeFileSync(tmpConfigPath, tmpConfig, 'utf8');

  const tmpEmitDir = mkdtempSync(join(exampleDir, '.pn-regen-example-'));

  let emitOutput;
  try {
    emitOutput = execFileSync(
      prismaBin,
      ['contract', 'emit', '--config', tmpConfigPath, '--output-path', tmpEmitDir, '--quiet'],
      { cwd: exampleDir, encoding: 'utf8', env: childEnv },
    );
  } finally {
    try {
      unlinkSync(tmpConfigPath);
    } catch {
      // best-effort cleanup; don't mask the original error
    }
  }

  // The engine bin emits NDJSON events; the last line is the result envelope.
  let parsed;
  try {
    const lines = emitOutput.trim().split('\n');
    parsed = JSON.parse(lines[lines.length - 1]);
  } catch {
    rmSync(tmpEmitDir, { recursive: true, force: true });
    throw new Error(
      `regen-example-migrations: prisma contract emit produced non-JSON output for ${migrationDir}:\n${emitOutput}`,
    );
  }

  const storageHash = parsed?.envelope?.result?.storageHash ?? parsed?.storageHash;
  if (typeof storageHash !== 'string' || !/^(?:[0-9a-f]{64}|empty)$/.test(storageHash)) {
    rmSync(tmpEmitDir, { recursive: true, force: true });
    throw new Error(
      `regen-example-migrations: emit output missing storageHash for ${migrationDir}:\n${emitOutput}`,
    );
  }

  try {
    const contractJson = JSON.parse(readFileSync(join(tmpEmitDir, 'contract.json'), 'utf8'));
    const contractDts = readFileSync(join(tmpEmitDir, 'contract.d.ts'), 'utf8');
    return { storageHash, contractJson, contractDts };
  } finally {
    rmSync(tmpEmitDir, { recursive: true, force: true });
  }
}

/**
 * Process a single migration directory.
 *
 * @param {string}        exampleDir         - Absolute path to the example package root.
 * @param {string}        migrationDir       - Absolute path to this migration dir.
 * @param {string}        migrationsRootDir  - Absolute path to the migrations root (parent of `app/`); where `snapshots/` lives.
 * @param {string|null}   prevHash           - Predecessor's freshly-emitted storageHash (null for baseline).
 * @param {string}        realConfigAbsPath  - Absolute path to the example's real config file.
 * @param {'mongo'|'sql'} contractFamily     - Which contract provider to use.
 * @returns {string} The freshly-emitted storageHash for this migration's end state.
 */
async function processMigration(
  exampleDir,
  migrationDir,
  migrationsRootDir,
  prevHash,
  realConfigAbsPath,
  contractFamily,
) {
  const {
    storageHash: newHash,
    contractJson,
    contractDts,
  } = emitMigrationContract(exampleDir, migrationDir, realConfigAbsPath, contractFamily);

  // The predecessor's end state (== this migration's start state) was
  // already written to the store on the previous chain iteration;
  // write-if-absent makes this call for `newHash` the only write needed.
  await writeContractSnapshot(migrationsRootDir, newHash, { contractJson, contractDts });

  const migrationTsPath = join(migrationDir, 'migration.ts');
  if (!existsSync(migrationTsPath)) {
    throw new Error(`regen-example-migrations: no migration.ts in ${migrationDir}`);
  }

  // Defensive: a no-op for every migration.ts in this repo today (all are
  // the contract-JSON-import shape), kept in case a pre-dedup hash-literal
  // shape is ever reintroduced.
  rewriteMigrationHashes(migrationTsPath, prevHash, newHash);

  const snapshotsImportPath = snapshotsImportPathFrom(migrationDir, migrationsRootDir);
  const migrationTsSrc = readFileSync(migrationTsPath, 'utf8');
  const rewrittenMigrationTs = rewriteContractSnapshotSpecifiers(
    migrationTsSrc,
    snapshotsImportPath,
    newHash,
    prevHash,
  );
  if (rewrittenMigrationTs !== migrationTsSrc) {
    writeFileSync(migrationTsPath, rewrittenMigrationTs, 'utf8');
  }

  // Re-run tsx migration.ts to regenerate ops.json + migration.json
  const tsx = join(exampleDir, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) {
    throw new Error(`regen-example-migrations: tsx not found at ${tsx}; run pnpm install`);
  }
  execFileSync(tsx, [migrationTsPath], {
    cwd: exampleDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: childEnv,
  });

  // Biome-format ops.json and migration.json
  for (const name of ['ops.json', 'migration.json']) {
    const p = join(migrationDir, name);
    if (existsSync(p)) {
      biomeFormatInPlace(p);
    }
  }

  return newHash;
}

/**
 * Walk all migration subdirectories of a chain in lexicographic order
 * (timestamped names are lexicographically chronological) and process each.
 */
async function processChain(chain) {
  const exampleDir = resolve(repoRoot, chain.exampleDir);
  const chainDir = resolve(exampleDir, chain.migrationsDir);
  const migrationsRootDir = dirname(chainDir);
  const realConfigAbsPath = resolve(repoRoot, chain.realConfigPath);

  let dirNames;
  try {
    dirNames = readdirSync(chainDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    throw new Error(`regen-example-migrations: cannot list directories in ${chainDir}`);
  }

  if (dirNames.length === 0) {
    process.stdout.write(`regen-example-migrations: no migration dirs in ${chainDir}\n`);
    return;
  }

  let prevHash = null;

  const contractFamily = chain.contractFamily ?? 'mongo';

  for (const dirName of dirNames) {
    const migrationDir = join(chainDir, dirName);
    prevHash = await processMigration(
      exampleDir,
      migrationDir,
      migrationsRootDir,
      prevHash,
      realConfigAbsPath,
      contractFamily,
    );
  }

  process.stdout.write(
    `regen-example-migrations: updated ${chain.exampleDir}/${chain.migrationsDir} (${dirNames.length} migrations)\n`,
  );
}

async function main() {
  let errors = 0;
  for (const chain of CHAINS) {
    try {
      await processChain(chain);
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      errors++;
    }
  }
  if (errors > 0) {
    process.exit(1);
  }
}

await main();
