import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { findPathWithDecision, reconstructGraph } from '@internal/migration-tools/migration-graph';
import { assertDescriptorSelfConsistency } from '@internal/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { describe, expect, it } from 'vitest';
import searchPathInstallOps from '../migrations/20261106T1401_install_postgis_on_search_path/ops.json' with {
  type: 'json',
};
import { POSTGIS_GEOMETRY_CODEC_ID } from '../src/core/constants';
import {
  POSTGIS_BASELINE_MIGRATION_NAME,
  POSTGIS_INSTALL_MIGRATION_NAME,
  POSTGIS_INVARIANTS,
  POSTGIS_NATIVE_TYPE,
  POSTGIS_SEARCH_PATH_INSTALL_MIGRATION_NAME,
  POSTGIS_SEARCH_PATH_MIGRATION_NAME,
  POSTGIS_SPACE_ID,
  POSTGIS_UPGRADE_MIGRATION_NAME,
} from '../src/core/contract-space-constants';
import { postgisExtensionDescriptor } from '../src/exports/control';

const space = postgisExtensionDescriptor.contractSpace!;
const headHash = space.contractJson.storage.storageHash;
const publicHeadHash = migration(POSTGIS_SEARCH_PATH_MIGRATION_NAME).metadata.from;

function migration(dirName: string) {
  const found = space.migrations.find((m) => m.dirName === dirName);
  if (found === undefined) throw new Error(`no migration ${dirName}`);
  return found;
}

describe('postgis extension descriptor', () => {
  it('declares the postgis extension and the parameterised geometry type', () => {
    const unboundNamespace = space.contractJson.storage.namespaces['__unbound__'] as {
      readonly entries: Record<string, Record<string, unknown>>;
    };
    expect(unboundNamespace.entries).toEqual({
      extension: { postgis: { kind: 'extension', name: 'postgis' } },
      table: {},
    });
    expect(space.contractJson.storage.types?.[POSTGIS_NATIVE_TYPE]).toMatchObject({
      codecId: POSTGIS_GEOMETRY_CODEC_ID,
    });
  });

  it('keeps the old install migration, which records the install invariant', () => {
    const baseline = migration(POSTGIS_BASELINE_MIGRATION_NAME);
    expect(baseline.metadata.from).toBeNull();
    expect(baseline.metadata.to).not.toBe(headHash);
    expect(baseline.metadata.providedInvariants).toEqual([POSTGIS_INVARIANTS.installPostgis]);
  });

  it('moves the first head to the public head by creating the extension if missing', () => {
    const upgrade = migration(POSTGIS_UPGRADE_MIGRATION_NAME);
    expect(upgrade.metadata).toMatchObject({
      from: migration(POSTGIS_BASELINE_MIGRATION_NAME).metadata.to,
      to: publicHeadHash,
      providedInvariants: [],
    });
    expect(upgrade.ops.map((op) => [op.id, op.invariantId])).toEqual([
      ['extension.postgis', undefined],
    ]);
  });

  it('builds a new database in one migration that records no invariant', () => {
    const install = migration(POSTGIS_INSTALL_MIGRATION_NAME);
    expect(install.metadata).toMatchObject({
      from: null,
      to: publicHeadHash,
      providedInvariants: [],
    });
    expect(install.ops.map((op) => op.id)).toEqual(['schema.public', 'extension.postgis']);
  });

  it('moves the public head to the head with no operation, since the search path finds the extension', () => {
    const searchPath = migration(POSTGIS_SEARCH_PATH_MIGRATION_NAME);
    expect(searchPath.metadata).toMatchObject({ to: headHash, providedInvariants: [] });
    expect(searchPath.ops).toEqual([]);
  });

  it('builds a new database at the head in one migration that names no schema for the extension', () => {
    const install = migration(POSTGIS_SEARCH_PATH_INSTALL_MIGRATION_NAME);
    expect(install.metadata).toMatchObject({ from: null, to: headHash, providedInvariants: [] });
    expect(install.ops.map((op) => op.id)).toEqual(['schema.public', 'extension.postgis']);
    expect(searchPathInstallOps.map((op) => [op.id, op.execute.map((step) => step.sql)])).toEqual([
      ['schema.public', ['CREATE SCHEMA IF NOT EXISTS "public"']],
      ['extension.postgis', ['CREATE EXTENSION IF NOT EXISTS "postgis"']],
    ]);
  });

  it('takes an empty database to the head through the one-step migration', () => {
    const graph = reconstructGraph(space.migrations.map((m) => ({ ...m, dirPath: m.dirName })));
    const outcome = findPathWithDecision(graph, EMPTY_CONTRACT_HASH, headHash, {
      required: new Set(space.headRef.invariants),
    });
    expect(
      outcome.kind === 'ok' ? outcome.decision.selectedPath.map((edge) => edge.dirName) : outcome,
    ).toEqual([POSTGIS_SEARCH_PATH_INSTALL_MIGRATION_NAME]);
  });

  it('points the head ref at the contract and requires no invariant', () => {
    expect(space.headRef).toEqual({ hash: headHash, invariants: [] });
  });

  it("records each migration's hash of its contents", () => {
    const hashes = (hash: (m: (typeof space.migrations)[number]) => string) =>
      Object.fromEntries(space.migrations.map((m) => [m.dirName, hash(m)]));
    expect(space.migrations).toHaveLength(5);
    expect(hashes((m) => computeMigrationHash(m.metadata, m.ops))).toEqual(
      hashes((m) => m.metadata.migrationHash),
    );
  });

  it('passes the self-consistency check', () => {
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: POSTGIS_SPACE_ID,
        target: space.contractJson.target,
        targetFamily: space.contractJson.targetFamily,
        storage: space.contractJson.storage,
        headRefHash: space.headRef.hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });
});
