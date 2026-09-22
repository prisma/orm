#!/usr/bin/env node
/**
 * Regenerates migration metadata for all extension packages that carry an
 * on-disk `migrations/` tree, keeping them consistent with the freshly-built
 * `src/contract.json` after `pnpm build:contract-space` / `pnpm fixtures:emit`.
 *
 * For each extension under packages/3-extensions/ that contains a
 * `migrations/` directory the script:
 *
 *   1. Reads `src/contract.json` -> `storage.storageHash` (new end-state hash).
 *   2. Locates the HEAD migration - the one whose `migration.json` sets
 *      `"to"` equal to the hash published in `migrations/refs/head.json`.
 *      Because every current extension has exactly one (baseline) migration
 *      with `from: null`, the head migration is always unambiguous; the
 *      script halts with an error if the chain is ambiguous or the head
 *      migration cannot be identified.
 *   3. Rewrites the `to` literal in that migration's `migration.ts` to the
 *      new storageHash.
 *   4. Re-emits `ops.json` + `migration.json` by running `tsx migration.ts`
 *      from the extension package root (tsx because the migration imports
 *      relative TypeScript siblings).
 *   5. Re-pins `migrations/refs/head.json` with the new hash, preserving
 *      the existing `invariants` array verbatim.
 *   6. Writes `src/contract.{json,d.ts}` into the migrations-root-wide
 *      content-addressed store (`migrations/snapshots/<hex>/`, write-if-
 *      absent) under the new hash, and rewrites any `endContract` /
 *      `Contract as End` import specifiers in the head migration's
 *      `migration.ts` to point at it (a no-op for the hand-authored
 *      Path B migrations in this repo today, which carry no such import).
 *   7. Runs `biome format` via stdin on each touched JSON file so output is
 *      byte-identical to the committed canonical format (biome keeps short
 *      arrays inline and adds a trailing newline).
 *
 * If the new storageHash already matches the published `head.json` hash the
 * extension is skipped (already consistent) - making the script idempotent.
 *
 * Usage:
 *   node scripts/regen-extension-migrations.mjs
 *
 * Wired into the root `package.json` as `"migrations:regen"` and chained
 * after `build:contract-space` in `fixtures:emit`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
} from '@internal/framework-components/control';
import { snapshotsImportPathFrom } from '@internal/migration-tools/contract-snapshot-store';
import { refreshContractSnapshot } from './refresh-contract-snapshot.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = join(repoRoot, 'packages', '3-extensions');
const tsx = join(repoRoot, 'node_modules', '.bin', 'tsx');
const biome = join(repoRoot, 'node_modules', '.bin', 'biome');

/**
 * Read and parse a JSON file, returning the parsed object.
 * Throws a descriptive error on missing or malformed files.
 */
function readJson(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`regen-extension-migrations: cannot read ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`regen-extension-migrations: malformed JSON in ${filePath}: ${err.message}`);
  }
}

/**
 * Format a file's content through `biome format --stdin-file-path <basename>`
 * and write the result back in place.
 *
 * Using stdin bypasses biome's `files.includes` exclusion globs (which exclude
 * migration.json, ops.json, end-contract.json, and *.d.ts from the normal
 * check/format pass) while still applying the project's formatter settings
 * (lineWidth, indentStyle, etc.). The result is byte-identical to what biome
 * would produce if the file were not excluded — short arrays stay inline,
 * trailing newline is present — matching the committed canonical format.
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
 * Find the migration directory whose `migration.json` has a `to` field
 * matching `headHash`. Returns the directory path.
 *
 * Halts (throws) when:
 *   - No migration directory matches (chain is broken -- head.json is stale
 *     in a way regen cannot fix automatically).
 *   - More than one migration directory matches (ambiguous HEAD -- not expected
 *     in the current single-migration baseline layout; human review required).
 */
function findHeadMigrationDir(migrationsDir, headHash) {
  let migrationDirs;
  try {
    migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'refs')
      .map((e) => join(migrationsDir, e.name));
  } catch {
    throw new Error(
      `regen-extension-migrations: cannot list migration directories in ${migrationsDir}`,
    );
  }

  const matching = migrationDirs.filter((dir) => {
    const metaPath = join(dir, 'migration.json');
    if (!existsSync(metaPath)) return false;
    const meta = readJson(metaPath);
    return meta.to === headHash;
  });

  if (matching.length === 0) {
    throw new Error(
      `regen-extension-migrations: no migration directory in ${migrationsDir} has "to": "${headHash}" -- ` +
        'head.json may be stale in an unexpected way; manual review required',
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `regen-extension-migrations: multiple migration directories match "to": "${headHash}" in ${migrationsDir} -- ` +
        `ambiguous HEAD; manual review required: ${matching.join(', ')}`,
    );
  }
  return matching[0];
}

/**
 * Rewrite the `to:` hash literal in a `migration.ts` file.
 *
 * Matches the pattern:
 *   to: '<hex>',
 * or
 *   to: "<hex>",
 * (with optional surrounding whitespace) and replaces the hash value.
 *
 * New-shape migrations (post TML-2892) carry no hash literals: they import the
 * committed `end-contract.json` and the `Migration` base derives `describe()`'s
 * from/to from that JSON's `storage.storageHash`. For that shape there is
 * nothing to rewrite here; the caller syncs end-contract.json before re-emitting.
 *
 * Throws if the pattern is not found exactly once (old shape only).
 */
function rewriteMigrationToHash(migrationTsPath, newHash) {
  const src = readFileSync(migrationTsPath, 'utf8');
  // Match the `to:` property value -- either single or double-quoted bare-hex hash.
  const pattern = /(to:\s*['"])(?:[0-9a-f]{64}|empty)(['"])/g;
  const matches = [...src.matchAll(pattern)];
  if (src.includes('endContractJson = endContract') && matches.length === 0) {
    return false;
  }
  if (matches.length === 0) {
    // Migrations that import their end contract from the snapshot store carry
    // no `to:` literal; their `to` derives from the imported endContractJson
    // after the snapshot import specifiers are rewritten.
    return false;
  }
  if (matches.length > 1) {
    throw new Error(
      `regen-extension-migrations: found ${matches.length} 'to: ...' hash literals in ${migrationTsPath}; expected exactly 1`,
    );
  }
  const updated = src.replace(pattern, `$1${newHash}$2`);
  if (updated === src) {
    return false;
  }
  writeFileSync(migrationTsPath, updated, 'utf8');
  return true;
}

/**
 * Re-emit ops.json + migration.json for the given extension by running
 * `tsx <migrationTsPath>` with the extension package directory as cwd.
 */
function reemitMigrationArtifacts(extDir, migrationTsPath) {
  execFileSync(tsx, [migrationTsPath], {
    cwd: extDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

/**
 * Rewrite `migrations/refs/head.json`, replacing `hash` with `newHash`
 * and preserving the existing `invariants` array verbatim. The file is
 * then passed through `biome format` (via stdin) so the output matches
 * the committed canonical format: short arrays inline, trailing newline.
 */
function repinHeadRef(headRefPath, newHash) {
  const existing = readJson(headRefPath);
  const updated = { hash: newHash, invariants: existing.invariants };
  writeFileSync(headRefPath, JSON.stringify(updated, null, 2), 'utf8');
  biomeFormatInPlace(headRefPath);
}

/**
 * Rewrite the store specifiers in a migration.ts's contract import block —
 * `import endContract from '...'` and `import type { Contract as End } from
 * '...'` — to point at `toHash`'s store entry. Keyed on the fixed import
 * bindings the renderers always emit rather than on whatever hex the
 * specifier currently encodes, so it is idempotent regardless of the
 * previous hash. A no-op (via `String.prototype.replace`'s no-match
 * passthrough) on migrations that carry no such import — e.g. the
 * hand-authored Path B extension migrations, whose `describe()` returns a
 * hash literal instead.
 */
function rewriteContractSnapshotSpecifiers(source, snapshotsImportPath, toHash) {
  return source
    .replace(
      /(import\s+endContract\s+from\s+')[^']*(')/,
      `$1${contractSnapshotJsonSpecifier(snapshotsImportPath, toHash)}$2`,
    )
    .replace(
      /(import\s+type\s*\{\s*Contract\s+as\s+End\s*\}\s+from\s+')[^']*(')/,
      `$1${contractSnapshotTypesSpecifier(snapshotsImportPath, toHash)}$2`,
    );
}

/**
 * Process one extension directory. Returns `'skipped'` or `'updated'`;
 * throws on error.
 */
async function processExtension(extDir) {
  const migrationsDir = join(extDir, 'migrations');
  if (!existsSync(migrationsDir)) {
    return 'skipped';
  }

  // PSL-authored extensions place the emitted contract under
  // src/contract/contract.json; TypeScript-authored ones use src/contract.json
  // directly. Try both locations.
  let contractJsonPath = join(extDir, 'src', 'contract.json');
  if (!existsSync(contractJsonPath)) {
    const nestedPath = join(extDir, 'src', 'contract', 'contract.json');
    if (existsSync(nestedPath)) {
      contractJsonPath = nestedPath;
    } else {
      throw new Error(
        `regen-extension-migrations: ${extDir} has migrations/ but no src/contract.json or src/contract/contract.json`,
      );
    }
  }

  const contractJson = readJson(contractJsonPath);
  const newHash = contractJson?.storage?.storageHash;
  if (typeof newHash !== 'string' || !/^(?:[0-9a-f]{64}|empty)$/.test(newHash)) {
    throw new Error(
      `regen-extension-migrations: could not read storage.storageHash from ${contractJsonPath}`,
    );
  }

  const headRefPath = join(migrationsDir, 'refs', 'head.json');
  if (!existsSync(headRefPath)) {
    throw new Error(
      `regen-extension-migrations: expected ${headRefPath} to exist; cannot identify HEAD migration`,
    );
  }

  const headRef = readJson(headRefPath);
  const oldHash = headRef.hash;

  const contractDts = readFileSync(join(dirname(contractJsonPath), 'contract.d.ts'), 'utf8');
  const snapshot = await refreshContractSnapshot(migrationsDir, newHash, {
    contractJson,
    contractDts,
  });

  if (oldHash === newHash) {
    return snapshot.written ? 'refreshed' : 'skipped';
  }

  const headMigrationDir = findHeadMigrationDir(migrationsDir, oldHash);
  const migrationTsPath = join(headMigrationDir, 'migration.ts');
  if (!existsSync(migrationTsPath)) {
    throw new Error(`regen-extension-migrations: no migration.ts in ${headMigrationDir}`);
  }

  const snapshotsImportPath = snapshotsImportPathFrom(headMigrationDir, migrationsDir);
  const migrationTsSrc = readFileSync(migrationTsPath, 'utf8');
  const hasSnapshotImports = /import\s+endContract\s+from\s+'/.test(migrationTsSrc);
  const rewrittenMigrationTs = rewriteContractSnapshotSpecifiers(
    migrationTsSrc,
    snapshotsImportPath,
    newHash,
  );
  if (rewrittenMigrationTs !== migrationTsSrc) {
    writeFileSync(migrationTsPath, rewrittenMigrationTs, 'utf8');
  }
  const rewroteToLiteral = rewriteMigrationToHash(migrationTsPath, newHash);
  if (!rewroteToLiteral && !hasSnapshotImports) {
    throw new Error(
      `regen-extension-migrations: ${migrationTsPath} carries neither a 'to: ...' hash literal nor snapshot-store contract imports; cannot re-anchor`,
    );
  }
  reemitMigrationArtifacts(extDir, migrationTsPath);
  const freshMigrationMeta = readJson(join(headMigrationDir, 'migration.json'));
  if (freshMigrationMeta.to !== newHash) {
    throw new Error(
      `regen-extension-migrations: ${headMigrationDir} re-emitted "to": "${freshMigrationMeta.to}" but expected "${newHash}"`,
    );
  }
  biomeFormatInPlace(join(headMigrationDir, 'migration.json'));
  biomeFormatInPlace(join(headMigrationDir, 'ops.json'));
  repinHeadRef(headRefPath, newHash);

  return 'updated';
}

// Additional extension package roots outside packages/3-extensions/ that also
// carry on-disk migrations + head refs and need to stay consistent.
const extraExtensionRoots = [
  join(repoRoot, 'examples', 'multi-extension-monorepo', 'packages', 'audit'),
  join(repoRoot, 'examples', 'multi-extension-monorepo', 'packages', 'feature-flags'),
];

async function main() {
  let entries;
  try {
    entries = readdirSync(extensionsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    process.stderr.write(
      `regen-extension-migrations: cannot list ${extensionsDir}: ${err.message}\n`,
    );
    process.exit(1);
  }

  let errors = 0;
  for (const entry of entries) {
    const extDir = join(extensionsDir, entry.name);
    try {
      const result = await processExtension(extDir);
      if (result !== 'skipped') {
        process.stdout.write(`regen-extension-migrations: ${result} ${entry.name}\n`);
      }
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      errors++;
    }
  }

  for (const extDir of extraExtensionRoots) {
    if (!existsSync(extDir)) continue;
    try {
      const result = await processExtension(extDir);
      if (result !== 'skipped') {
        process.stdout.write(`regen-extension-migrations: ${result} ${extDir}\n`);
      }
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
