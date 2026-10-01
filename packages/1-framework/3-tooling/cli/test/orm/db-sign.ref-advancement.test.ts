import { existsSync, writeFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import {
  contractSnapshotDir,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { notOk } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONNECTION,
  cleanupProjectDirs,
  envelopeOf,
  HASH_A,
  HASH_PREVIOUS,
  harness,
  MISSING_COLUMN,
  mocks,
  ormConfig,
  projectDir,
  RENDERED_CONTRACT_DTS,
  refHashOf,
  refsDirOf,
  resetMocks,
  schemaResult,
} from './db-sign-fixtures';

const HASH_B = `55bada2${'0'.repeat(57)}`;
const SNAPSHOT_B_DTS = 'export type Contract = { b: true };\n';

beforeEach(resetMocks);
afterEach(cleanupProjectDirs);

describe('db sign', () => {
  describe('ref advancement', () => {
    it('writes the db ref and the snapshot of the signed contract', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(0);
      expect(await refHashOf(dir, 'db')).toBe(HASH_A);
      const storeDir = contractSnapshotDir(join(dir, 'migrations'), HASH_A);
      expect(JSON.parse(await readFile(join(storeDir, 'contract.json'), 'utf-8'))).toEqual({
        storage: { storageHash: HASH_A },
        target: 'postgres',
      });
      expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(RENDERED_CONTRACT_DTS);
    });

    it('still advances db when --db names the database', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig({ db: undefined })).run(
        ['db', 'sign', '--db', CONNECTION, '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ advancedRef: { name: 'db', hash: HASH_A } });
      expect(await refHashOf(dir, 'db')).toBe(HASH_A);
    });

    it('advances the ref named by --advance-ref and leaves db untouched', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(
        ['db', 'sign', '--advance-ref', 'staging', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        advancedRef: { name: 'staging', hash: HASH_A },
      });
      expect(await refHashOf(dir, 'staging')).toBe(HASH_A);
      expect(await refHashOf(dir, 'db')).toBeUndefined();
    });

    it('overwrites a ref pointing elsewhere and reports the previous hash', async () => {
      const dir = await projectDir();
      await writeRef(refsDirOf(dir), 'db', { hash: HASH_PREVIOUS, invariants: [] });

      const run = await harness(ormConfig()).run(['db', 'sign'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.exitCode).toBe(0);
      expect(await refHashOf(dir, 'db')).toBe(HASH_A);
      expect(run.presented?.presentation.human.at(-1)).toEqual({
        kind: 'summary',
        status: 'ok',
        text: [
          { text: 'Advanced ref "db" → ' },
          { text: HASH_A, tone: 'identifier' },
          { text: ' (was ', tone: 'muted' },
          { text: HASH_PREVIOUS, tone: 'identifier' },
          { text: ')', tone: 'muted' },
        ],
      });
    });

    it('refuses a rejected ref name before verifying or signing', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(
        ['db', 'sign', '--advance-ref', 'Not A Ref', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.INVALID_REF_NAME' },
      });
      expect(mocks.schemaVerify).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(existsSync(refsDirOf(dir))).toBe(false);
    });

    it('snapshots the contract it read once, even when contract.json is rewritten after the read', async () => {
      const dir = await projectDir();
      const rewritten = { storage: { storageHash: HASH_B }, target: 'postgres' };
      const family = ormConfig()['family'] as Record<string, unknown>;
      const rewritingFamily = {
        ...family,
        create: () => ({
          deserializeContract: (json: unknown) => {
            writeFileSync(join(dir, 'output', 'contract.json'), JSON.stringify(rewritten), 'utf-8');
            return { ...Object(json), hydrated: true };
          },
        }),
      };

      const run = await harness(ormConfig({ family: rewritingFamily })).run(
        ['db', 'sign', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(0);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      expect(await refHashOf(dir, 'db')).toBe(HASH_A);
      const storeDir = contractSnapshotDir(join(dir, 'migrations'), HASH_A);
      expect(JSON.parse(await readFile(join(storeDir, 'contract.json'), 'utf-8'))).toEqual({
        storage: { storageHash: HASH_A },
        target: 'postgres',
      });
    });

    it('writes no ref when verification refuses the signature', async () => {
      const dir = await projectDir();
      mocks.schemaVerify.mockResolvedValue(
        schemaResult({
          ok: false,
          code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
          summary: 'Database schema does not satisfy contract',
          schema: { issues: [MISSING_COLUMN] },
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(existsSync(refsDirOf(dir))).toBe(false);
      expect(existsSync(join(dir, 'migrations', 'snapshots'))).toBe(false);
    });

    it('reads only the ref it advances, so a corrupt sibling ref cannot fail the signature', async () => {
      const dir = await projectDir();
      await writeRef(refsDirOf(dir), 'db', { hash: HASH_PREVIOUS, invariants: [] });
      await writeFile(join(refsDirOf(dir), 'staging.json'), '{ not json', 'utf-8');

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ advancedRef: { name: 'db', hash: HASH_A } });
      expect(await refHashOf(dir, 'db')).toBe(HASH_A);
    });

    it('snapshots the types rendered from the contract, not the contract.d.ts on disk', async () => {
      const dir = await projectDir();
      await rm(join(dir, 'output', 'contract.d.ts'));

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(0);
      expect(mocks.renderContractDts).toHaveBeenCalledWith({
        contract: { storage: { storageHash: HASH_A }, target: 'postgres' },
        resolveImportSpecifier: expect.any(Function),
      });
      const storeDir = contractSnapshotDir(join(dir, 'migrations'), HASH_A);
      expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(RENDERED_CONTRACT_DTS);
    });

    it('refuses before verifying or signing when the contract types cannot be rendered', async () => {
      const dir = await projectDir();
      mocks.renderContractDts.mockResolvedValue(
        notOk({
          code: 'RENDER_FAILED',
          summary: 'Failed to render contract types',
          why: 'relation author must declare nullability',
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT.TYPES_RENDER_FAILED' },
      });
      expect(JSON.stringify(run.json.at(-1))).toContain('relation author must declare nullability');
      expect(mocks.schemaVerify).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(existsSync(refsDirOf(dir))).toBe(false);
      expect(existsSync(join(dir, 'migrations', 'snapshots'))).toBe(false);
    });

    it('refuses before verifying or signing when the family rejects the contract', async () => {
      const dir = await projectDir();
      mocks.renderContractDts.mockResolvedValue(
        notOk({
          code: 'CONTRACT_VALIDATION_FAILED',
          summary: 'Contract validation failed',
          why: 'storage.storageHash must be a string',
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT.VALIDATION_FAILED' },
      });
      expect(mocks.schemaVerify).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(existsSync(refsDirOf(dir))).toBe(false);
    });

    it('--no-advance-ref signs without contract.d.ts, since no snapshot is written', async () => {
      const dir = await projectDir();
      await rm(join(dir, 'output', 'contract.d.ts'));

      const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(0);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      expect(mocks.renderContractDts).not.toHaveBeenCalled();
      expect(run.presented?.data).toMatchObject({ advancedRef: null });
      expect(existsSync(join(dir, 'migrations', 'snapshots'))).toBe(false);
    });

    it('writes the snapshot from the resolved contract when a migration dir is named', async () => {
      const dir = await projectDir();
      const dirName = '20260102T0000_add_users';
      const ops = [
        blindCast<MigrationPlanOperation, 'db sign reads only the destination hash'>({
          id: 'table.users',
          label: 'Create users',
          operationClass: 'additive',
        }),
      ];
      const base = blindCast<
        Omit<MigrationMetadata, 'migrationHash'>,
        'db sign reads only from/to'
      >({
        from: HASH_A,
        to: HASH_B,
        providedInvariants: [],
        createdAt: '2026-01-02T10:00:00.000Z',
      });
      const metadata: MigrationMetadata = {
        ...base,
        migrationHash: computeMigrationHash(base, ops),
      };
      await writeMigrationPackage(join(dir, 'migrations', 'app', dirName), metadata, ops);
      const snapshotB = { storage: { storageHash: HASH_B }, target: 'postgres' };
      await writeContractSnapshot(join(dir, 'migrations'), HASH_B, {
        contractJson: snapshotB,
        contractDts: SNAPSHOT_B_DTS,
      });
      await rm(join(dir, 'output', 'contract.d.ts'));

      const run = await harness(ormConfig()).run(['db', 'sign', dirName, '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(0);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      const signArg = mocks.sign.mock.calls[0]?.[0] as {
        contract: { storage: { storageHash: string } };
      };
      expect(signArg.contract.storage.storageHash).toBe(HASH_B);
      expect(mocks.renderContractDts).toHaveBeenCalledWith(
        expect.objectContaining({ contract: snapshotB }),
      );
      expect(await refHashOf(dir, 'db')).toBe(HASH_B);
      const storeDir = contractSnapshotDir(join(dir, 'migrations'), HASH_B);
      expect(JSON.parse(await readFile(join(storeDir, 'contract.json'), 'utf-8'))).toEqual(
        snapshotB,
      );
      expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(SNAPSHOT_B_DTS);
    });

    it('--no-advance-ref signs but writes no ref and no snapshot', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(0);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      expect(run.presented?.data).toMatchObject({ advancedRef: null });
      expect(existsSync(refsDirOf(dir))).toBe(false);
      expect(existsSync(join(dir, 'migrations', 'snapshots'))).toBe(false);
    });

    it('--no-advance-ref reports the ref as left untouched', async () => {
      const dir = await projectDir();
      await writeRef(refsDirOf(dir), 'db', { hash: HASH_PREVIOUS, invariants: [] });

      const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.exitCode).toBe(0);
      expect(await refHashOf(dir, 'db')).toBe(HASH_PREVIOUS);
      expect(run.presented?.presentation.human.at(-1)).toEqual({
        kind: 'summary',
        status: 'info',
        tone: 'muted',
        text: 'Left ref "db" untouched (--no-advance-ref)',
      });
    });

    it('refuses --no-advance-ref together with --advance-ref before signing', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(
        ['db', 'sign', '--no-advance-ref', '--advance-ref', 'staging', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.ADVANCE_REF_ARG_CONFLICT' },
      });
      expect(mocks.schemaVerify).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(existsSync(refsDirOf(dir))).toBe(false);
    });
  });
});
