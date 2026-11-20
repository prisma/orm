// describeMatrix making eslint unhappy about the test names
/* eslint-disable jest/no-identical-title */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MigrateDiff } from '../commands/MigrateDiff'
import { setupCockroach, tearDownCockroach } from '../utils/setupCockroach'
import { setupMSSQL, tearDownMSSQL } from '../utils/setupMSSQL'
import { setupMysql, tearDownMysql } from '../utils/setupMysql'
import type { SetupParams } from '../utils/setupPostgres'
import { setupPostgres, tearDownPostgres } from '../utils/setupPostgres'
import {
  cockroachdbOnly,
  describeMatrix,
  mongodbOnly,
  noDriverAdapters,
  postgresOnly,
  sqlServerOnly,
} from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

const isWindows = os.platform() === 'win32'

describe('migrate diff', () => {
  describeMatrix(noDriverAdapters, 'D1', () => {
    it('should succeed when --from-config-datasource and a single local Cloudflare D1 database exists', async () => {
      ctx.fixture('cloudflare-d1-one-db')

      const result = await MigrateDiff.new('prisma').parse(
        ['--to-empty', '--from-config-datasource', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      expect(result).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- DropTable
        PRAGMA foreign_keys=off;
        DROP TABLE "Post";
        PRAGMA foreign_keys=on;

        -- DropTable
        PRAGMA foreign_keys=off;
        DROP TABLE "User";
        PRAGMA foreign_keys=on;
        "
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('should succeed when --to-config-datasource and a single local Cloudflare D1 database exists', async () => {
      ctx.fixture('cloudflare-d1-one-db')

      const result = await MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-config-datasource', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      expect(result).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('should succeed when --from-config-datasource and a single local Cloudflare D1 database exists', async () => {
      ctx.fixture('cloudflare-d1-one-db')

      const url = path.join(
        ctx.fs.cwd(),
        '.wrangler',
        'state',
        'v3',
        'd1',
        'miniflare-D1DatabaseObject',
        '5d11bcce386042472d19a6a4f58e40041ebc5932c972e1449cbf404f3e3c4a7a.sqlite',
      )
      ctx.setDatasource({ url: `file:${url}` })

      const result = await MigrateDiff.new('prisma').parse(
        ['--to-empty', '--from-config-datasource', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      expect(result).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- DropTable
        PRAGMA foreign_keys=off;
        DROP TABLE "Post";
        PRAGMA foreign_keys=on;

        -- DropTable
        PRAGMA foreign_keys=off;
        DROP TABLE "User";
        PRAGMA foreign_keys=on;
        "
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('should succeed when --to-config-datasource and a single local Cloudflare D1 database exists', async () => {
      ctx.fixture('cloudflare-d1-one-db')

      const url = path.join(
        ctx.fs.cwd(),
        '.wrangler',
        'state',
        'v3',
        'd1',
        'miniflare-D1DatabaseObject',
        '5d11bcce386042472d19a6a4f58e40041ebc5932c972e1449cbf404f3e3c4a7a.sqlite',
      )
      ctx.setDatasource({ url: `file:${url}` })

      const result = await MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-config-datasource', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      expect(result).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "Post" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "title" TEXT NOT NULL,
            "authorId" INTEGER NOT NULL,
            FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        );

        -- CreateTable
        CREATE TABLE "User" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "email" TEXT NOT NULL,
            "count1" INTEGER NOT NULL,
            "name" TEXT
        );

        -- CreateIndex
        CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);
        "
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })
  })

  describe('generic', () => {
    it('wrong flag', async () => {
      const commandInstance = MigrateDiff.new('prisma')
      const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

      await commandInstance.parse(['--something'], await ctx.config(), ctx.configDir())
      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    })

    it('help flag', async () => {
      const commandInstance = MigrateDiff.new('prisma')
      const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

      await commandInstance.parse(['--help'], await ctx.config(), ctx.configDir())
      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    })

    it('should fail if missing --from-... and --to-...', async () => {
      ctx.fixture('schema-only')

      const result = MigrateDiff.new('prisma').parse([], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrow()
    })

    it('should fail if only --from-... is provided', async () => {
      ctx.fixture('schema-only')

      const result = MigrateDiff.new('prisma').parse(['--from-empty'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrow()
    })

    it('should fail if only --to-... is provided', async () => {
      ctx.fixture('schema-only')

      const result = MigrateDiff.new('prisma').parse(['--to-empty'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrow()
    })

    it('should fail if more than 1 --from-... is provided', async () => {
      ctx.fixture('schema-only')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-empty', '--from-config-datasource'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).rejects.toThrow()
    })

    it('should fail if more than 1 --to-... is provided', async () => {
      ctx.fixture('schema-only')

      const result = MigrateDiff.new('prisma').parse(
        ['--to-empty', '--to-config-datasource'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).rejects.toThrow()
    })

    it('should fail for empty/empty', async () => {
      ctx.fixture('schema-only')
      expect.assertions(2)

      try {
        await MigrateDiff.new('prisma').parse(['--from-empty', '--to-empty'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual(undefined)
        expect(e.message).toMatchInlineSnapshot(`
          "Could not determine the connector to use for diffing.

          "
        `)
      }
    })

    it.each([
      '--from-url=localhost',
      '--to-url=localhost',
      '--from-schema-datasource=schema.prisma',
      '--to-schema-datasource=schema.prisma',
      '--from-schema-datamodel=schema.prisma',
      '--to-schema-datamodel=schema.prisma',
      '--from-local-d1',
      '--to-local-d1',
    ])('should fail with a hint when providing a %s parameter', async (param) => {
      ctx.fixture('schema-only')

      const result = MigrateDiff.new('prisma').parse([param], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingSnapshot()
    })
  })

  describe('sqlite', () => {
    it('should diff --from-empty --to-schema=./prisma/schema.prisma', async () => {
      ctx.fixture('schema-only-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-schema=./prisma/schema.prisma'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "
        [+] Added tables
          - Blog
        "
      `)
    })

    it('should diff --from-empty --to-schema=./prisma/schema (folder)', async () => {
      ctx.fixture('schema-folder-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-schema=./prisma/schema'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "
        [+] Added tables
          - Blog
          - User
        "
      `)
    })

    it('should diff --from-empty --to-schema=./prisma/schema.prisma --script', async () => {
      ctx.fixture('schema-only-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-schema=./prisma/schema.prisma', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "Blog" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "viewCount20" INTEGER NOT NULL
        );
        "
      `)
    })

    it('should diff --from-schema=./prisma/schema.prisma --to-empty', async () => {
      ctx.fixture('schema-only-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-schema=./prisma/schema.prisma', '--to-empty'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "
        [-] Removed tables
          - Blog
        "
      `)
    })

    it('should diff --from-schema=./prisma/schema (folder) --to-empty', async () => {
      ctx.fixture('schema-folder-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-schema=./prisma/schema', '--to-empty'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "
        [-] Removed tables
          - Blog
          - User
        "
      `)
    })

    it('should diff --from-schema=./prisma/schema.prisma --to-empty --script', async () => {
      ctx.fixture('schema-only-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-schema=./prisma/schema.prisma', '--to-empty', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- DropTable
        PRAGMA foreign_keys=off;
        DROP TABLE "Blog";
        PRAGMA foreign_keys=on;
        "
      `)
    })

    it('should diff and write to output path', async () => {
      ctx.fixture('schema-only-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-schema=./prisma/schema.prisma', '--to-empty', '--script', '--output=./output.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)
      expect(ctx.fs.read('./output.sql')).toMatchInlineSnapshot(`
        "-- DropTable
        PRAGMA foreign_keys=off;
        DROP TABLE "Blog";
        PRAGMA foreign_keys=on;
        "
      `)
    })

    it('should diff and write to output path if directory does not exist', async () => {
      ctx.fixture('schema-only-sqlite')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-schema=./prisma/schema.prisma', '--to-empty', '--script', '--output=./subdir/output.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)
      expect(ctx.fs.read('./subdir/output.sql')).toMatchInlineSnapshot(`
        "-- DropTable
        PRAGMA foreign_keys=off;
        DROP TABLE "Blog";
        PRAGMA foreign_keys=on;
        "
      `)
    })

    it('should fail with EACCES/EPERM when writing to output path which is read only', async () => {
      ctx.fixture('schema-only-sqlite')

      // Create a readonly file
      ctx.fs.write('./readonly.sql', 'test', {
        mode: 0o444,
      })
      const result = MigrateDiff.new('prisma').parse(
        ['--from-schema=./prisma/schema.prisma', '--to-empty', '--script', '--output=./readonly.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      // Example error message:
      // macOS
      // [Error: EACCES: permission denied, open '/private/var/folders/qt/13pk8tq5113437vp1xr2l_s40000gn/T/f322d2ba6d947ea7c04312edde54aba3/readonly.sql']
      // Windows
      // EPERM: operation not permitted, open 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\61b2f2248cfc996bff236aa42e874653\\readonly.sql'
      await expect(result).rejects.toThrow(isWindows ? 'EPERM' : 'EACCES')
    })

    describeMatrix(noDriverAdapters, 'non driver adapter', () => {
      it('should fail --from-empty --to-config-datasource', async () => {
        ctx.fixture('schema-only-sqlite')
        ctx.setDatasource({ url: 'file:doesnotexists.db' })

        const result = MigrateDiff.new('prisma').parse(
          ['--from-empty', '--to-config-datasource'],
          await ctx.config(),
          ctx.configDir(),
        )
        await expect(result).rejects.toMatchInlineSnapshot(`
                  "P1003

                  Database \`doesnotexists.db\` does not exist
                  "
              `)
      })

      it('should fail --from-config-datasource --to-empty', async () => {
        ctx.fixture('schema-only-sqlite')
        ctx.setDatasource({ url: 'file:doesnotexists.db' })

        const result = MigrateDiff.new('prisma').parse(
          ['--from-config-datasource', '--to-empty'],
          await ctx.config(),
          ctx.configDir(),
        )
        await expect(result).rejects.toMatchInlineSnapshot(`
                  "P1003

                  Database \`doesnotexists.db\` does not exist
                  "
              `)
      })

      it('should fail if directory in path & sqlite file does not exist', async () => {
        ctx.fixture('schema-only-sqlite')
        ctx.setDatasource({ url: 'file:./something/doesnotexists.db' })

        const result = MigrateDiff.new('prisma').parse(
          ['--from-config-datasource', '--to-empty'],
          await ctx.config(),
          ctx.configDir(),
        )
        await expect(result).rejects.toMatchInlineSnapshot(`
                  "P1003

                  Database \`doesnotexists.db\` does not exist
                  "
              `)
        expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      })

      it('should diff --from-empty --to-config-datasource', async () => {
        ctx.fixture('introspection/sqlite')

        const result = MigrateDiff.new('prisma').parse(
          ['--from-empty', '--to-config-datasource'],
          await ctx.config(),
          ctx.configDir(),
        )
        await expect(result).resolves.toMatchInlineSnapshot(`""`)
        expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
                  "
                  [+] Added tables
                    - Post
                    - Profile
                    - User
                    - _Migration

                  [*] Changed the \`Profile\` table
                    [+] Added unique index on columns (userId)

                  [*] Changed the \`User\` table
                    [+] Added unique index on columns (email)
                  "
              `)
      })

      it('should diff --from-empty --to-config-datasource with nested config and schema', async () => {
        ctx.fixture('prisma-config-nested-sqlite')
        ctx.setConfigFile('config/prisma.config.ts')

        await fs.writeFile(path.join(ctx.configDir(), 'dev.db'), '')

        const result = MigrateDiff.new('prisma').parse(
          ['--from-empty', '--to-config-datasource'],
          await ctx.config(),
          ctx.configDir(),
        )
        await expect(result).resolves.toMatchInlineSnapshot(`""`)
        expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
          "No difference detected.
          "
        `)
      })

      it('should diff --from-config-datasource --to-empty with nested config and schema', async () => {
        ctx.fixture('prisma-config-nested-sqlite')
        ctx.setConfigFile('config/prisma.config.ts')

        await fs.writeFile(path.join(ctx.configDir(), 'dev.db'), '')

        const result = MigrateDiff.new('prisma').parse(
          ['--from-config-datasource', '--to-empty'],
          await ctx.config(),
          ctx.configDir(),
        )
        await expect(result).resolves.toMatchInlineSnapshot(`""`)
        expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
          "No difference detected.
          "
        `)
      })

      it('should diff --from-empty --to-config-datasource --script', async () => {
        ctx.fixture('introspection/sqlite')

        const result = MigrateDiff.new('prisma').parse(
          ['--from-empty', '--to-config-datasource', '--script'],
          await ctx.config(),
          ctx.configDir(),
        )
        await expect(result).resolves.toMatchInlineSnapshot(`""`)
        expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
          "-- CreateTable
          CREATE TABLE "Post" (
              "authorId" INTEGER NOT NULL,
              "content" TEXT,
              "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
              "published" BOOLEAN NOT NULL DEFAULT false,
              "title" TEXT NOT NULL,
              FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );

          -- CreateTable
          CREATE TABLE "Profile" (
              "bio" TEXT,
              "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
              "userId" INTEGER NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );

          -- CreateTable
          CREATE TABLE "User" (
              "email" TEXT NOT NULL,
              "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
              "name" TEXT
          );

          -- CreateTable
          CREATE TABLE "_Migration" (
              "revision" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
              "name" TEXT NOT NULL,
              "datamodel" TEXT NOT NULL,
              "status" TEXT NOT NULL,
              "applied" INTEGER NOT NULL,
              "rolled_back" INTEGER NOT NULL,
              "datamodel_steps" TEXT NOT NULL,
              "database_migration" TEXT NOT NULL,
              "errors" TEXT NOT NULL,
              "started_at" DATETIME NOT NULL,
              "finished_at" DATETIME
          );

          -- CreateIndex
          CREATE UNIQUE INDEX "Profile.userId" ON "Profile"("userId" ASC);

          -- CreateIndex
          CREATE UNIQUE INDEX "User.email" ON "User"("email" ASC);
          "
        `)
      })
    })

    describe('--exit-code', () => {
      it('should exit with code 2 when diff is not empty without --script', async () => {
        ctx.fixture('schema-only-sqlite')

        const result = MigrateDiff.new('prisma').parse(
          ['--from-schema=./prisma/schema.prisma', '--to-empty', '--exit-code'],
          await ctx.config(),
          ctx.configDir(),
        )

        await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 2"`)
        expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
        expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
          "
          [-] Removed tables
            - Blog
          "
        `)

        expect(ctx.recordedExitCode()).toEqual(2)
      })

      it('should exit with code 2 when diff is not empty with --script', async () => {
        ctx.fixture('schema-only-sqlite')

        const result = MigrateDiff.new('prisma').parse(
          ['--from-schema=./prisma/schema.prisma', '--to-empty', '--script', '--exit-code'],
          await ctx.config(),
          ctx.configDir(),
        )

        await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 2"`)
        expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
        expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
          "-- DropTable
          PRAGMA foreign_keys=off;
          DROP TABLE "Blog";
          PRAGMA foreign_keys=on;
          "
        `)

        expect(ctx.recordedExitCode()).toEqual(2)
      })
    })
  })

  describeMatrix(mongodbOnly, 'mongodb', () => {
    // it('should diff --from-url=$TEST_MONGO_URI --to-schema=./prisma/schema.prisma', async () => {
    //   ctx.fixture('schema-only-mongodb')

    //   const result = MigrateDiff.new('prisma').parse([
    //     '--from-url',
    //     process.env.TEST_MONGO_URI!,
    //     // '--to-empty',
    //     '--to-schema=./prisma/schema.prisma',
    //   ])
    //   await expect(result).resolves.toMatchInlineSnapshot(``)
    //   expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
    //     [+] Collection \`User\`

    //   `)
    // })

    it('should diff --from-empty --to-schema=./prisma/schema.prisma', async () => {
      ctx.fixture('schema-only-mongodb')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-schema=./prisma/schema.prisma'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "[+] Collection \`User\`
        "
      `)
    })

    it('should diff --from-schema=./prisma/schema.prisma --to-empty', async () => {
      ctx.fixture('schema-only-mongodb')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-schema=./prisma/schema.prisma', '--to-empty'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "No difference detected.
        "
      `)
    })

    it('should fail with not supported error with --script', async () => {
      ctx.fixture('schema-only-mongodb')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-schema=./prisma/schema.prisma', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "Rendering to a script is not supported on MongoDB.

        "
      `)
    })
  })

  describeMatrix(cockroachdbOnly, 'cockroachdb', () => {
    if (!process.env.TEST_SKIP_COCKROACHDB && !process.env.TEST_COCKROACH_URI_MIGRATE) {
      throw new Error('You must set a value for process.env.TEST_COCKROACH_URI_MIGRATE. See TESTING.md')
    }
    const connectionString = process.env.TEST_COCKROACH_URI_MIGRATE
    const setupParams = {
      connectionString: connectionString!,
      dirname: '',
    }

    beforeAll(async () => {
      await tearDownCockroach(setupParams).catch((e) => {
        console.error(e)
      })
    })

    beforeEach(async () => {
      await setupCockroach(setupParams).catch((e) => {
        console.error(e)
      })

      ctx.setDatasource({ url: connectionString! })
    })

    afterEach(async () => {
      await tearDownCockroach(setupParams).catch((e) => {
        console.error(e)
      })
    })

    it('should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script', async () => {
      ctx.fixture('schema-only-cockroachdb')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-config-datasource', '--to-schema=./prisma/schema.prisma', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "Blog" (
            "id" INT4 NOT NULL,
            "viewCount20" INT4 NOT NULL,

            CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
        );
        "
      `)
    }, 10_000)
  })

  describeMatrix(postgresOnly, 'postgres', () => {
    const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!

    const setupParams: SetupParams = {
      connectionString,
      dirname: '',
    }

    beforeEach(async () => {
      await setupPostgres(setupParams).catch((e) => {
        console.error(e)
      })
      ctx.setDatasource({ url: connectionString })
    })

    afterEach(async () => {
      await tearDownPostgres(setupParams).catch((e) => {
        console.error(e)
      })
    })

    it('should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script', async () => {
      ctx.fixture('schema-only-postgresql')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-config-datasource', '--to-schema=./prisma/schema.prisma', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "Blog" (
            "id" INTEGER NOT NULL,
            "viewCount20" INTEGER NOT NULL,

            CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
        );
        "
      `)
    })

    it('should exclude external tables from diff', async () => {
      ctx.fixture('external-tables')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-empty', '--to-schema=./schema.prisma'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      // Note the missing warnings about the User table as it is marked as external and won't be modified
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "No difference detected.
        "
      `)
    })
  })

  describeMatrix({ providers: { mysql: true } }, 'mysql', () => {
    const connectionString = process.env.TEST_MYSQL_URI_MIGRATE!

    const setupParams: SetupParams = {
      connectionString,
      dirname: '',
    }

    beforeAll(async () => {
      await tearDownMysql(setupParams).catch((e) => {
        console.error(e)
      })
    })

    beforeEach(async () => {
      await setupMysql(setupParams).catch((e) => {
        console.error(e)
      })

      ctx.setDatasource({ url: connectionString })
    })

    afterEach(async () => {
      await tearDownMysql(setupParams).catch((e) => {
        console.error(e)
      })
    })

    it('should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script', async () => {
      ctx.fixture('schema-only-mysql')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-config-datasource', '--to-schema=./prisma/schema.prisma', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE \`Blog\` (
            \`id\` INTEGER NOT NULL,
            \`viewCount20\` INTEGER NOT NULL,

            PRIMARY KEY (\`id\`)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        "
      `)
    })
  })

  describeMatrix(sqlServerOnly, 'sqlserver', () => {
    if (!process.env.TEST_SKIP_MSSQL && !process.env.TEST_MSSQL_JDBC_URI_MIGRATE) {
      throw new Error('You must set a value for process.env.TEST_MSSQL_JDBC_URI_MIGRATE. See TESTING.md')
    }
    const databaseName = 'tests-migrate'
    const jdbcConnectionString = process.env.TEST_MSSQL_JDBC_URI_MIGRATE!

    const setupParams: SetupParams = {
      connectionString: process.env.TEST_MSSQL_URI!,
      dirname: '',
    }

    beforeAll(async () => {
      await tearDownMSSQL(setupParams, databaseName).catch((e) => {
        console.error(e)
      })
    })

    beforeEach(async () => {
      await setupMSSQL(setupParams, databaseName).catch((e) => {
        console.error(e)
      })

      const shadowDatabaseUrl = process.env.TEST_MSSQL_SHADOWDB_JDBC_URI_MIGRATE?.replace(
        'tests-migrate-shadowdb',
        `${databaseName}-shadowdb`,
      )
      ctx.setDatasource({ url: jdbcConnectionString!, shadowDatabaseUrl })
    })

    afterEach(async () => {
      await tearDownMSSQL(setupParams, databaseName).catch((e) => {
        console.error(e)
      })
    })

    it('should diff --from-config-datasource --to-schema=./prisma/schema.prisma --script', async () => {
      ctx.fixture('schema-only-sqlserver')

      const result = MigrateDiff.new('prisma').parse(
        ['--from-config-datasource', '--to-schema=./prisma/schema.prisma', '--script'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(result).resolves.toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "BEGIN TRY

        BEGIN TRAN;

        -- CreateTable
        CREATE TABLE [dbo].[Blog] (
            [id] INT NOT NULL,
            [viewCount20] INT NOT NULL,
            CONSTRAINT [Blog_pkey] PRIMARY KEY CLUSTERED ([id])
        );

        COMMIT TRAN;

        END TRY
        BEGIN CATCH

        IF @@TRANCOUNT > 0
        BEGIN
            ROLLBACK TRAN;
        END;
        THROW

        END CATCH
        "
      `)
    })
  })
})
