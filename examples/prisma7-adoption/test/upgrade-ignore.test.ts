/**
 * A project that signed and planned migrations with a Prisma 8 that left
 * `@ignore` and `@@ignore` objects out of the contract upgrades to one that
 * keeps them. Its storage hash changes. It plans a migration, which records
 * the ignored objects for a database replayed from the migrations, then signs:
 * the database already has the objects, so signing finds nothing, `db migrate`
 * applies nothing, and the next `migration plan` plans nothing.
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

describe('upgrading a signed project whose Prisma 7 schema uses @ignore', () => {
  it(
    'records the ignored objects in a migration, re-signs with no findings, and then plans nothing',
    async () => {
      const dir = copyExample();
      try {
        await withDevDatabase(async ({ connectionString }) => {
          writeFileSync(join(dir, '.env'), `DATABASE_URL=${connectionString}\n`);
          const v7 = (...args: string[]) =>
            run(dir, connectionString, 'prisma7', [...args, '--config', 'prisma7.config.ts']);
          const v8 = async (...args: string[]) =>
            resultEnvelope(await run(dir, connectionString, 'prisma', args)).result;
          const useSchema = (text: string) =>
            writeFileSync(join(dir, 'prisma/schema.prisma'), text);

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

          const recorded = await v8('migration', 'plan', '--name', 'keep-ignored-objects');
          expect(recorded).toMatchObject({ from: earlierHash, to: upgradedHash });
          expect(
            (recorded['operations'] as readonly { readonly id: string }[]).map((op) => op.id),
          ).toEqual([
            'table.Tag',
            'table._PostToTag',
            'column.public.User.name',
            'index.Tag.Tag_name_key',
            'index._PostToTag._PostToTag_B_index',
            'foreignKey._PostToTag._PostToTag_A_fkey',
            'foreignKey._PostToTag._PostToTag_B_fkey',
          ]);

          expect(await v8('db', 'sign')).toMatchObject({
            spaces: [{ status: 'updated', contract: { storageHash: upgradedHash } }],
          });
          expect(dbRefHash(dir)).toBe(upgradedHash);
          await verifyHasNoFindings(dir, connectionString);
          expect(await v8('db', 'migrate')).toMatchObject({ ok: true, migrationsApplied: 0 });
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
    },
    timeouts.spinUpPpgDev * 2,
  );
});
