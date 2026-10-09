/**
 * A project that signed and planned migrations with a Prisma 8 that left
 * `@ignore` and `@@ignore` objects out of the contract upgrades to one that
 * keeps them. Its storage hash changes. It plans a migration, which records
 * the ignored objects for a database rebuilt from the migrations, and then
 * brings the existing database to the new hash: by signing it, or by
 * `db migrate --advance-ref db`, whose runner skips each create because the
 * object already exists. Either way the next `migration plan` plans nothing.
 *
 * The earlier reader's contract is the one the schema gives with the ignored
 * field, the ignored model and the relation field pointing to it deleted: that
 * reader dropped exactly those objects, the implicit junction with them.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  copyExample,
  EXAMPLE_ROOT,
  readContract,
  resultEnvelope,
  run,
  runAllowingFailure,
  verifyHasNoFindings,
} from './story';

const SCHEMA = readFileSync(join(EXAMPLE_ROOT, 'prisma/schema.prisma'), 'utf-8');

function replaced(text: string, from: string | RegExp, to: string): string {
  expect(text).toMatch(from);
  return text.replace(from, to);
}

const WITH_IGNORE = replaced(
  replaced(
    replaced(SCHEMA, /^( {2}name\s+String\?)$/m, '$1 @ignore'),
    /^( {2}tags\s+Tag\[\])$/m,
    '$1 @ignore',
  ),
  /^( {2}posts Post\[\]\n)\}/m,
  '$1\n  @@ignore\n}',
);

const AS_THE_EARLIER_READER_READ_IT = replaced(
  replaced(replaced(SCHEMA, /^ {2}name\s+String\?\n/m, ''), /^ {2}tags\s+Tag\[\]\n/m, ''),
  /\nmodel Tag \{[^}]*\}\n/,
  '',
);

function storageHash(dir: string): string {
  return JSON.parse(readContract(dir)).storage.storageHash;
}

function dbRefHash(dir: string): string {
  return JSON.parse(readFileSync(join(dir, 'migrations/app/refs/db.json'), 'utf-8')).hash;
}

type Prisma8 = (...args: string[]) => Promise<Record<string, unknown>>;

interface Hashes {
  readonly earlier: string;
  readonly upgraded: string;
}

function expectRecordsIgnoredObjects(plan: Record<string, unknown>, hashes: Hashes): void {
  expect(plan).toMatchObject({ from: hashes.earlier, to: hashes.upgraded });
  expect((plan['operations'] as readonly { readonly id: string }[]).map((op) => op.id)).toEqual([
    'table.Tag',
    'table._PostToTag',
    'column.public.User.name',
    'index.Tag.Tag_name_key',
    'index._PostToTag._PostToTag_B_index',
    'foreignKey._PostToTag._PostToTag_A_fkey',
    'foreignKey._PostToTag._PostToTag_B_fkey',
  ]);
}

async function upgradeAfterHandover(
  recordAndBringToNewHash: (
    v8: Prisma8,
    hashes: Hashes,
    run: (...args: string[]) => ReturnType<typeof runAllowingFailure>,
    dbRef: () => string,
  ) => Promise<void>,
): Promise<void> {
  const dir = copyExample();
  try {
    await withDevDatabase(async ({ connectionString }) => {
      writeFileSync(join(dir, '.env'), `DATABASE_URL=${connectionString}\n`);
      const v7 = (...args: string[]) =>
        run(dir, connectionString, 'prisma7', [...args, '--config', 'prisma7.config.ts']);
      const v8: Prisma8 = async (...args) =>
        resultEnvelope(await run(dir, connectionString, 'prisma', args)).result;
      const useSchema = (text: string) => writeFileSync(join(dir, 'prisma/schema.prisma'), text);

      await v7('migrate', 'deploy');
      useSchema(AS_THE_EARLIER_READER_READ_IT);
      await v8('contract', 'emit');
      const earlierHash = storageHash(dir);
      await v8('db', 'sign');
      expect(await v8('migration', 'plan', '--name', 'baseline')).toMatchObject({
        from: earlierHash,
        to: earlierHash,
      });

      useSchema(WITH_IGNORE);
      await v8('contract', 'emit');
      const upgradedHash = storageHash(dir);
      expect(upgradedHash).not.toBe(earlierHash);

      await recordAndBringToNewHash(
        v8,
        { earlier: earlierHash, upgraded: upgradedHash },
        (...args) => runAllowingFailure(dir, connectionString, 'prisma', args),
        () => dbRefHash(dir),
      );
      expect(dbRefHash(dir)).toBe(upgradedHash);
      await verifyHasNoFindings(dir, connectionString);
      expect(await v8('migration', 'plan', '--name', 'after-upgrade')).toMatchObject({
        ok: true,
        noOp: true,
        from: upgradedHash,
        to: upgradedHash,
        operations: [],
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('upgrading a project whose Prisma 7 schema uses @ignore, after the handover', () => {
  it(
    'records the ignored objects in a migration, signs with no findings, and then plans nothing',
    () =>
      upgradeAfterHandover(async (v8, hashes) => {
        expectRecordsIgnoredObjects(
          await v8('migration', 'plan', '--name', 'keep-ignored-objects'),
          hashes,
        );
        expect(await v8('db', 'sign')).toMatchObject({
          spaces: [{ status: 'updated', contract: { storageHash: hashes.upgraded } }],
        });
        expect(await v8('db', 'migrate')).toMatchObject({ ok: true, migrationsApplied: 0 });
      }),
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'records the ignored objects in a migration, which migrating skips because they exist, and then plans nothing',
    () =>
      upgradeAfterHandover(async (v8, hashes) => {
        expectRecordsIgnoredObjects(
          await v8('migration', 'plan', '--name', 'keep-ignored-objects'),
          hashes,
        );
        expect(await v8('db', 'migrate', '--advance-ref', 'db')).toMatchObject({
          ok: true,
          markerHash: hashes.upgraded,
          advancedRef: { name: 'db', hash: hashes.upgraded },
        });
      }),
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'records the ignored objects in a migration, which plain migrating skips and signing then catches the db ref up to',
    () =>
      upgradeAfterHandover(async (v8, hashes, _prisma, dbRef) => {
        expectRecordsIgnoredObjects(
          await v8('migration', 'plan', '--name', 'keep-ignored-objects'),
          hashes,
        );
        expect(await v8('db', 'migrate')).toMatchObject({ ok: true, markerHash: hashes.upgraded });
        expect(dbRef()).toBe(hashes.earlier);
        await v8('db', 'sign');
      }),
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'recovers from signing before planning by planning from the earlier hash',
    () =>
      upgradeAfterHandover(async (v8, hashes, prisma) => {
        await v8('db', 'sign');
        const refused = await prisma('migration', 'plan', '--name', 'keep-ignored-objects');
        expect(refused.status, refused.output).not.toBe(0);
        expect(resultEnvelope(refused.output)).toMatchObject({
          ok: false,
          error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH' },
        });
        expectRecordsIgnoredObjects(
          await v8('migration', 'plan', '--from', hashes.earlier, '--name', 'keep-ignored-objects'),
          hashes,
        );
      }),
    timeouts.spinUpPpgDev * 2,
  );
});
