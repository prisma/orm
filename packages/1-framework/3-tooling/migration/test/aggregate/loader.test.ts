import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract, ContractRelation } from '@internal/contract/types';
import { crossRef, UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import { validateContractDomain } from '@internal/contract/validate-domain';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { isStructuredError } from '@internal/utils/structured-error';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadContractSpaceAggregate } from '../../src/aggregate/loader';
import type { ContractSpaceAggregate } from '../../src/aggregate/types';
import { writeContractSnapshot } from '../../src/contract-snapshot-store';
import type { IntegrityViolation } from '../../src/integrity-violation';
import { writeTestPackage } from '../fixtures';

/**
 * Build a SQL/postgres contract that claims the given storage element
 * names as tables. The storage hash is computed by `createSqlContract`.
 */
function sqlContractWithTables(args: { target?: string; tables: readonly string[] }): Contract {
  const tables = Object.fromEntries(args.tables.map((name) => [name, { columns: { id: {} } }]));
  return createSqlContract({
    target: args.target ?? 'postgres',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
      },
    },
  });
}

const APP_CONTRACT = sqlContractWithTables({ tables: ['user'] });

// Identity deserializer: the loader reads the raw on-disk contract.json
// and hands the parsed value here; tests stand it up as a typed contract
// without separate validation. The cast is test-only (production wires a
// family-aware validator). `as` is permitted in test files.
const identityDeserialize = (json: unknown): Contract => json as Contract;

describe('loadContractSpaceAggregate', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'load-aggregate-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  function load(appContract: Contract = APP_CONTRACT): Promise<ContractSpaceAggregate> {
    return loadContractSpaceAggregate({
      migrationsDir,
      deserializeContract: identityDeserialize,
      appContract,
    });
  }

  /** Write a migration package under `migrations/<spaceId>/<dirName>`. */
  function writePackage(
    spaceId: string,
    dirName: string,
    meta: Parameters<typeof writeTestPackage>[1] = {},
    ops?: Parameters<typeof writeTestPackage>[2],
  ): Promise<unknown> {
    return writeTestPackage(join(migrationsDir, spaceId, dirName), meta, ops);
  }

  /** Write `migrations/<spaceId>/refs/head.json`. */
  async function writeHeadRef(
    spaceId: string,
    headRef: { hash: string; invariants: readonly string[] },
  ): Promise<void> {
    const refsDir = join(migrationsDir, spaceId, 'refs');
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'head.json'), JSON.stringify(headRef, null, 2));
  }

  /** Write a contract snapshot store entry keyed by `storageHash`. */
  async function writeContractSnapshotEntry(storageHash: string, contract: unknown): Promise<void> {
    await writeContractSnapshot(migrationsDir, storageHash, {
      contractJson: contract,
      contractDts: 'export type Contract = unknown;\n',
    });
  }

  function violationsOfKind<K extends IntegrityViolation['kind']>(
    violations: readonly IntegrityViolation[],
    kind: K,
  ): readonly Extract<IntegrityViolation, { kind: K }>[] {
    return violations.filter((v): v is Extract<IntegrityViolation, { kind: K }> => v.kind === kind);
  }

  describe('tolerant construction', () => {
    it('resolves with an empty extension set when migrations/ is absent', async () => {
      const aggregate = await load();
      expect(aggregate.app.spaceId).toBe('app');
      expect(aggregate.extensions).toEqual([]);
    });

    it('never throws on a hash-mismatched, unparseable, or self-edge package', async () => {
      // app: a self-edge package (from === to, no data op).
      await writePackage('app', '20260101T0000_self', {
        from: 'app-head',
        to: 'app-head',
      });
      // alpha: a hash-mismatched package (retained) and no head ref.
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'a1' });
      await writeFile(join(migrationsDir, 'alpha', '20260101T0000_init', 'ops.json'), '[]');
      // beta: an unparseable package (omitted) and a head ref.
      await mkdir(join(migrationsDir, 'beta', '20260101T0000_broken'), { recursive: true });
      await writeFile(
        join(migrationsDir, 'beta', '20260101T0000_broken', 'migration.json'),
        'not json',
      );
      await writeFile(join(migrationsDir, 'beta', '20260101T0000_broken', 'ops.json'), '[]');
      await writeHeadRef('beta', { hash: 'b1', invariants: [] });

      const aggregate = await load();
      expect(aggregate.listSpaces()).toEqual(['app', 'alpha', 'beta']);
      // Recoverable packages are retained; the unparseable one is omitted.
      expect(aggregate.space('alpha')?.packages).toHaveLength(1);
      expect(aggregate.space('beta')?.packages).toHaveLength(0);
    });
  });

  describe('extension spaces with no migration packages', () => {
    it('reads head ref from disk when space has no packages', async () => {
      const extContract = sqlContractWithTables({ tables: ['ext_table'] });
      const headHash = extContract.storage.storageHash;
      // Write the space artifacts including head.json (as emitContractSpaceArtifacts does).
      await writeContractSnapshotEntry(headHash, extContract);
      await writeHeadRef('supabase', { hash: headHash, invariants: [] });

      const aggregate = await load();
      const space = aggregate.space('supabase');
      expect(space).toBeDefined();
      expect(space?.packages).toHaveLength(0);
      expect(space?.headRef).toEqual({ hash: headHash, invariants: [] });
    });

    it('produces no headRefNotInGraph violation when packages is empty and head.json is on disk', async () => {
      const extContract = sqlContractWithTables({ tables: ['ext_table'] });
      await writeContractSnapshotEntry(extContract.storage.storageHash, extContract);
      await writeHeadRef('supabase', { hash: extContract.storage.storageHash, invariants: [] });

      const aggregate = await load();
      const violations = aggregate.checkIntegrity();
      expect(violationsOfKind(violations, 'headRefMissing').map((v) => v.spaceId)).not.toContain(
        'supabase',
      );
      expect(violationsOfKind(violations, 'headRefNotInGraph').map((v) => v.spaceId)).not.toContain(
        'supabase',
      );
    });

    it('reports headRefMissing for an extension space with no packages and no head.json', async () => {
      // No packages and no head.json — headRefMissing is always an authoring error.
      // The space directory itself exists on disk (e.g. scaffolded but never
      // seeded), which is what makes it enumerable at all.
      await mkdir(join(migrationsDir, 'supabase'), { recursive: true });

      const aggregate = await load();
      const violations = aggregate.checkIntegrity();
      expect(violationsOfKind(violations, 'headRefMissing').map((v) => v.spaceId)).toContain(
        'supabase',
      );
    });

    it('still reports headRefMissing for a migration-backed space with no head.json', async () => {
      await writePackage('backed', '20260101T0000_init', { from: null, to: 'b1' });

      const aggregate = await load();
      const violations = aggregate.checkIntegrity();
      expect(violationsOfKind(violations, 'headRefMissing').map((v) => v.spaceId)).toContain(
        'backed',
      );
    });

    it('contract() throws MIGRATION.CHECK_HEAD_REF_MISSING for a space with no head ref', async () => {
      await writePackage('backed', '20260101T0000_init', { from: null, to: 'b1' });

      const aggregate = await load();
      const space = aggregate.space('backed');
      let thrown: unknown;
      try {
        space?.contract();
      } catch (error) {
        thrown = error;
      }
      expect(isStructuredError(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: 'MIGRATION.CHECK_HEAD_REF_MISSING',
        message:
          'Contract space "backed" has no head ref; its contract cannot be resolved from the snapshot store without one.',
      });
    });

    it('reports headRefNotInGraph for a migration-backed space whose head hash is not in graph', async () => {
      // A loadable package with a known graph node, but head.json points elsewhere.
      await writePackage('backed', '20260101T0000_init', { from: null, to: 'b1' });
      await writeHeadRef('backed', { hash: 'not-in-graph', invariants: [] });

      const aggregate = await load();
      const violations = aggregate.checkIntegrity();
      expect(violationsOfKind(violations, 'headRefNotInGraph').map((v) => v.spaceId)).toContain(
        'backed',
      );
    });
  });

  describe('app space', () => {
    it('synthesises the app head ref from the live contract storage hash', async () => {
      const aggregate = await load();
      expect(aggregate.app.headRef).toEqual({
        hash: APP_CONTRACT.storage.storageHash,
        invariants: [],
      });
    });

    it('app.contract() returns the supplied live contract by reference', async () => {
      const aggregate = await load();
      expect(aggregate.app.contract()).toBe(APP_CONTRACT);
    });

    it('reads app migration packages from disk', async () => {
      await writePackage('app', '20260101T0000_init', { from: null, to: 'app-head' });
      const aggregate = await load();
      expect(aggregate.app.packages).toHaveLength(1);
      expect(aggregate.app.packages[0]?.dirName).toBe('20260101T0000_init');
    });
  });

  describe('lazy memoised facets', () => {
    it('graph() returns the same instance across calls', async () => {
      const aggregate = await load();
      expect(aggregate.app.graph()).toBe(aggregate.app.graph());
    });

    it('extension contract() deserializes the on-disk contract.json and memoises it', async () => {
      const extContract = sqlContractWithTables({ tables: ['ext_table'] });
      const headHash = extContract.storage.storageHash;
      await writePackage('cipherstash', '20260101T0000_init', { from: null, to: headHash });
      await writeHeadRef('cipherstash', { hash: headHash, invariants: [] });
      await writeContractSnapshotEntry(headHash, extContract);

      const aggregate = await load();
      const space = aggregate.space('cipherstash');
      const first = space?.contract();
      expect(first).toBe(space?.contract());
      expect(first?.target).toBe('postgres');
    });
  });

  describe('old-format snapshots', () => {
    /** Runs the framework domain validator the family deserializers run on every load. */
    const validatingDeserialize = (json: unknown): Contract => {
      const contract = json as Contract;
      validateContractDomain(contract);
      return contract;
    };

    /** An rc.9 snapshot: the to-one relation has no `nullable` key. */
    function oldFormatContract(): Contract {
      const int = { nullable: false, type: { kind: 'scalar' as const, codecId: 'pg/int4@1' } };
      const author = blindCast<
        ContractRelation,
        'an rc.9 contract.json relation has no nullable key'
      >({
        to: crossRef('User', UNBOUND_DOMAIN_NAMESPACE_ID),
        cardinality: 'N:1',
        on: { localFields: ['authorId'], targetFields: ['id'] },
      });
      return createSqlContract({
        roots: { posts: crossRef('Post', UNBOUND_DOMAIN_NAMESPACE_ID) },
        models: {
          Post: {
            fields: { id: int, authorId: int },
            relations: { author },
            storage: { namespaceId: UNBOUND_NAMESPACE_ID, table: 'post', fields: {} },
          },
          User: {
            fields: { id: int },
            relations: {},
            storage: { namespaceId: UNBOUND_NAMESPACE_ID, table: 'user', fields: {} },
          },
        },
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: { table: { post: { columns: {} }, user: { columns: {} } } },
            },
          },
        },
      });
    }

    it('loads an extension snapshot whose to-one relations predate the nullable flag', async () => {
      const extContract = oldFormatContract();
      const headHash = extContract.storage.storageHash;
      await writePackage('cipherstash', '20260101T0000_init', { from: null, to: headHash });
      await writeHeadRef('cipherstash', { hash: headHash, invariants: [] });
      await writeContractSnapshotEntry(headHash, extContract);
      const rewrite = await writeContractSnapshot(migrationsDir, headHash, {
        contractJson: { ...extContract, rewritten: true },
        contractDts: 'export type Contract = unknown;\n',
      });
      expect(rewrite.written).toBe(false);

      const aggregate = await loadContractSpaceAggregate({
        migrationsDir,
        deserializeContract: validatingDeserialize,
        appContract: APP_CONTRACT,
      });
      const loaded = aggregate.space('cipherstash')?.contract();
      expect(loaded?.storage.storageHash).toBe(headHash);
    });
  });

  describe('query methods', () => {
    it('lists app first, then extension ids lex-ascending', async () => {
      await writePackage('zeta', '20260101T0000_init', { from: null, to: 'z1' });
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'a1' });
      const aggregate = await load();
      expect(aggregate.listSpaces()).toEqual(['app', 'alpha', 'zeta']);
      expect(aggregate.spaces().map((m) => m.spaceId)).toEqual(['app', 'alpha', 'zeta']);
    });

    it('hasSpace / space resolve by id', async () => {
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'a1' });
      const aggregate = await load();
      expect(aggregate.hasSpace('app')).toBe(true);
      expect(aggregate.hasSpace('alpha')).toBe(true);
      expect(aggregate.hasSpace('missing')).toBe(false);
      expect(aggregate.space('alpha')?.spaceId).toBe('alpha');
      expect(aggregate.space('missing')).toBeUndefined();
    });
  });

  describe('checkIntegrity', () => {
    it('returns the full structural violation set without bailing at the first', async () => {
      await writePackage('app', '20260101T0000_self', {
        from: 'app-head',
        to: 'app-head',
      });
      // alpha: hash-mismatched package (retained) and no head.json → headRefMissing.
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'a1' });
      await writeFile(join(migrationsDir, 'alpha', '20260101T0000_init', 'ops.json'), '[]');
      // beta: unloadable package → packageUnloadable. Head.json present but
      // packages.length === 0 after load, so headRefNotInGraph does NOT fire.
      await mkdir(join(migrationsDir, 'beta', '20260101T0000_broken'), { recursive: true });
      await writeFile(
        join(migrationsDir, 'beta', '20260101T0000_broken', 'migration.json'),
        'not json',
      );
      await writeFile(join(migrationsDir, 'beta', '20260101T0000_broken', 'ops.json'), '[]');
      await writeHeadRef('beta', { hash: 'b1', invariants: [] });
      // gamma: loadable package but head.json points to a hash not in graph → headRefNotInGraph.
      await writePackage('gamma', '20260101T0000_init', { from: null, to: 'g1' });
      await writeHeadRef('gamma', { hash: 'not-in-graph', invariants: [] });

      const violations = (await load()).checkIntegrity();

      expect(violationsOfKind(violations, 'sameSourceAndTarget').map((v) => v.spaceId)).toContain(
        'app',
      );
      expect(violationsOfKind(violations, 'hashMismatch').map((v) => v.spaceId)).toContain('alpha');
      expect(violationsOfKind(violations, 'headRefMissing').map((v) => v.spaceId)).toContain(
        'alpha',
      );
      expect(violationsOfKind(violations, 'packageUnloadable').map((v) => v.spaceId)).toContain(
        'beta',
      );
      expect(violationsOfKind(violations, 'headRefNotInGraph').map((v) => v.spaceId)).toContain(
        'gamma',
      );
      // No bail: violations span more than one space.
      expect(
        new Set(violations.map((v) => ('spaceId' in v ? v.spaceId : '*'))).size,
      ).toBeGreaterThan(1);
    });

    it('omits config/contract checks unless the matching opt is set', async () => {
      await writePackage('orphan', '20260101T0000_init', { from: null, to: 'o1' });
      await writeHeadRef('orphan', { hash: 'o1', invariants: [] });
      const aggregate = await load();

      const bare = aggregate.checkIntegrity();
      expect(violationsOfKind(bare, 'orphanSpaceDir')).toHaveLength(0);
      expect(violationsOfKind(bare, 'targetMismatch')).toHaveLength(0);
    });

    it('gates layout-drift checks behind declaredExtensions', async () => {
      await writePackage('present', '20260101T0000_init', { from: null, to: 'p1' });
      await writeHeadRef('present', { hash: 'p1', invariants: [] });
      const aggregate = await load();

      const violations = aggregate.checkIntegrity({
        declaredExtensions: [{ id: 'declared-but-absent', targetId: 'postgres' }],
      });
      // `present` exists on disk but is not declared → orphanSpaceDir.
      expect(violationsOfKind(violations, 'orphanSpaceDir').map((v) => v.spaceId)).toEqual([
        'present',
      ]);
      // `declared-but-absent` is declared but has no on-disk dir.
      expect(violationsOfKind(violations, 'declaredButUnmigrated').map((v) => v.spaceId)).toEqual([
        'declared-but-absent',
      ]);
    });

    it('surfaces duplicateMigrationHash when two packages share a migrationHash', async () => {
      const meta = { from: null, to: 'dup-to' };
      await writePackage('app', '20260101T0000_first', meta);
      await writePackage('app', '20260101T0000_second', meta);

      const aggregate = await load();
      expect(() => aggregate.app.graph()).not.toThrow();

      const violations = aggregate.checkIntegrity();
      expect(violationsOfKind(violations, 'duplicateMigrationHash')).toEqual([
        {
          kind: 'duplicateMigrationHash',
          spaceId: 'app',
          migrationHash: expect.stringMatching(/^/),
          dirNames: ['20260101T0000_first', '20260101T0000_second'],
        },
      ]);
    });

    it('gates target / disjointness / contract checks behind checkContracts', async () => {
      // wrongtarget: a deserializable contract whose target differs.
      const wrongTargetContract = sqlContractWithTables({ target: 'sqlite', tables: ['wt'] });
      const wrongTargetHash = wrongTargetContract.storage.storageHash;
      await writePackage('wrongtarget', '20260101T0000_init', { from: null, to: wrongTargetHash });
      await writeHeadRef('wrongtarget', { hash: wrongTargetHash, invariants: [] });
      await writeContractSnapshotEntry(wrongTargetHash, wrongTargetContract);
      // sharer: claims the same `user` table as the app → disjointness.
      const sharerContract = sqlContractWithTables({ tables: ['user'] });
      const sharerHash = sharerContract.storage.storageHash;
      await writePackage('sharer', '20260101T0000_init', { from: null, to: sharerHash });
      await writeHeadRef('sharer', { hash: sharerHash, invariants: [] });
      await writeContractSnapshotEntry(sharerHash, sharerContract);
      // broken: head ref points at a hash with no store entry → contract()
      // throws → contractUnreadable.
      const brokenHash = '9'.repeat(64);
      await writePackage('broken', '20260101T0000_init', { from: null, to: brokenHash });
      await writeHeadRef('broken', { hash: brokenHash, invariants: [] });

      const aggregate = await load();

      const bare = aggregate.checkIntegrity();
      expect(violationsOfKind(bare, 'targetMismatch')).toHaveLength(0);
      expect(violationsOfKind(bare, 'disjointness')).toHaveLength(0);
      expect(violationsOfKind(bare, 'contractUnreadable')).toHaveLength(0);

      const gated = aggregate.checkIntegrity({ checkContracts: true });
      expect(violationsOfKind(gated, 'targetMismatch').map((v) => v.spaceId)).toContain(
        'wrongtarget',
      );
      expect(violationsOfKind(gated, 'disjointness').map((v) => v.element)).toContain(
        `${UNBOUND_NAMESPACE_ID}.user`,
      );
      expect(violationsOfKind(gated, 'contractUnreadable').map((v) => v.spaceId)).toContain(
        'broken',
      );
    });
  });

  describe('extension enumeration', () => {
    it('excludes reserved-named and grammar-invalid directories from extensions', async () => {
      // A grammar-valid extension dir is enumerated as a space.
      await writePackage('valid', '20260101T0000_init', { from: null, to: 'v1' });
      // The reserved per-space `refs` name at the migrations root is not a space.
      await mkdir(join(migrationsDir, 'refs'), { recursive: true });
      await writeFile(join(migrationsDir, 'refs', 'head.json'), '{}');
      // A directory whose name violates the space-id grammar (uppercase) is not a space.
      await mkdir(join(migrationsDir, 'Invalid_Caps'), { recursive: true });
      await writeFile(join(migrationsDir, 'Invalid_Caps', 'placeholder'), 'x');

      const aggregate = await load();

      expect(aggregate.listSpaces()).toEqual(['app', 'valid']);
      expect(aggregate.extensions.map((m) => m.spaceId)).toEqual(['valid']);
    });
  });

  describe('refUnreadable', () => {
    it('omits a corrupt named ref and surfaces refUnreadable for it', async () => {
      await writePackage('alpha', '20260101T0000_init', { from: null, to: 'a1' });
      await writeHeadRef('alpha', { hash: 'a1', invariants: [] });
      const refsDir = join(migrationsDir, 'alpha', 'refs');
      await mkdir(refsDir, { recursive: true });
      await writeFile(join(refsDir, 'production.json'), 'not json');

      const aggregate = await load();
      expect(aggregate.space('alpha')?.refs).not.toHaveProperty('production');

      const violations = aggregate.checkIntegrity();
      expect(
        violationsOfKind(violations, 'refUnreadable').map((v) => ({
          spaceId: v.spaceId,
          refName: v.refName,
        })),
      ).toContainEqual({ spaceId: 'alpha', refName: 'production' });
    });

    it('reports a corrupt head.json as refUnreadable, not headRefMissing', async () => {
      await writePackage('beta', '20260101T0000_init', { from: null, to: 'b1' });
      const refsDir = join(migrationsDir, 'beta', 'refs');
      await mkdir(refsDir, { recursive: true });
      await writeFile(join(refsDir, 'head.json'), '{ corrupt');

      const aggregate = await load();
      const violations = aggregate.checkIntegrity();

      expect(
        violationsOfKind(violations, 'refUnreadable').map((v) => ({
          spaceId: v.spaceId,
          refName: v.refName,
        })),
      ).toContainEqual({ spaceId: 'beta', refName: 'head' });
      expect(violationsOfKind(violations, 'headRefMissing').map((v) => v.spaceId)).not.toContain(
        'beta',
      );
    });

    it('still reports headRefMissing when head.json is genuinely absent', async () => {
      await writePackage('gamma', '20260101T0000_init', { from: null, to: 'g1' });

      const aggregate = await load();
      const violations = aggregate.checkIntegrity();

      expect(violationsOfKind(violations, 'headRefMissing').map((v) => v.spaceId)).toContain(
        'gamma',
      );
      expect(violationsOfKind(violations, 'refUnreadable').map((v) => v.spaceId)).not.toContain(
        'gamma',
      );
    });
  });
});
