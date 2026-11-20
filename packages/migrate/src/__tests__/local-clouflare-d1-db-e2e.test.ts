import path from 'node:path'

import { type BaseContext } from '@prisma/get-platform'
import { execa, type ExecaError } from 'execa'

import { MigrateDiff } from '../../src'
import { describeMatrix } from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

// Wrangler is spawned about a dozen times per test, so it is started from its
// entry point with the current Node.js binary. Running it through a package
// manager instead would add another process and a workspace resolution to every
// one of those spawns, which dominates the runtime of this suite on Windows.
const wranglerBin = require.resolve('wrangler/bin/wrangler.js')

describeMatrix({ providers: { d1: true } }, 'd1 local', () => {
  // Each test walks through a full migration workflow, spawning Wrangler about a
  // dozen times along the way. On the Windows CI runners that takes several
  // times as long as it does locally, so the budget has to be generous.
  jest.setTimeout(120_000)

  async function runWranglerCLI(ctx: BaseContext, ...args: string[]) {
    return await execa(process.execPath, [wranglerBin, '--config', path.join(ctx.tmpDir, 'wrangler.toml'), ...args], {
      cwd: __dirname,
    })
  }

  async function createWranglerD1Migration(ctx: BaseContext, { name }: { name: string }) {
    return await runWranglerCLI(ctx, 'd1', 'migrations', 'create', 'D1_DATABASE', name)
  }

  async function applyWranglerD1Migration(ctx: BaseContext) {
    return await runWranglerCLI(ctx, 'd1', 'migrations', 'apply', 'D1_DATABASE', '--local')
  }

  async function executeWranglerD1Command(ctx: BaseContext, { command, json }: { command: string; json?: boolean }) {
    const args = ['d1', 'execute', 'D1_DATABASE', '--local', '--command', command]

    if (json) {
      args.push('--json')
    }

    return await runWranglerCLI(ctx, ...args)
  }

  // We follow the steps in https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1#migration-workflows.
  describe('d1 migration workflow', () => {
    // See changing_all_referenced_columns_of_foreign_key_works
    // in https://github.com/prisma/prisma-engines/blob/f8f78f335fd86dea323d7fbc581fdf500d745e9a/schema-engine/sql-migration-tests/tests/migrations/foreign_keys.rs#L287-L318.
    it.failing('changing_all_referenced_columns_of_foreign_key_works', async () => {
      const cliInstance = MigrateDiff.new('prisma')
      ctx.fixture('schema-sqlite-d1-change-all-referenced-columns')

      // Create D1 database
      const wranglerCreateD1 = await executeWranglerD1Command(ctx, { command: 'SELECT 1;' })
      expect(wranglerCreateD1.exitCode).toBe(0)

      // Create `init` migration file for D1 using `wrangler d1 migrations`
      const wranglerCreateInitMigration = await createWranglerD1Migration(ctx, { name: 'init' })
      expect(wranglerCreateInitMigration.exitCode).toBe(0)

      // Create `init` SQL migration using `prisma migrate diff`
      const prismaCreateInitMigration = cliInstance.parse(
        ['--from-empty', '--to-schema', './prisma/schema.prisma', '--script', '--output', './migrations/0001_init.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prismaCreateInitMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `init` SQL migration file
      const initMigrationSQL = ctx.fs.readAsync('./migrations/0001_init.sql')
      await expect(initMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "Post" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "authorId" INTEGER,
            CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        );

        -- CreateTable
        CREATE TABLE "User" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
        );
        "
      `)

      // Apply `init` migration to D1
      const wranglerExecuteInitMigration = await applyWranglerD1Migration(ctx)
      expect(wranglerExecuteInitMigration.exitCode).toBe(0)

      //
      // Evolve the Prisma data model
      //

      // Create `change_all_referenced_columns` migration file for D1 using `wrangler d1 migrations`
      const wrangler2ndMigration = await createWranglerD1Migration(ctx, {
        name: 'change_all_referenced_columns',
      })
      expect(wrangler2ndMigration.exitCode).toBe(0)

      // Create `change_all_referenced_columns` migration SQL using `prisma migrate diff`
      const prisma2ndMigration = cliInstance.parse(
        [
          '--from-local-d1',
          '--to-schema',
          './prisma/schema-0002_change_all_referenced_columns.prisma',
          '--script',
          '--output',
          './migrations/0002_change_all_referenced_columns.sql',
        ],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prisma2ndMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `change_all_referenced_columns` SQL migration file
      const prisma2ndMigrationSQL = ctx.fs.readAsync('./migrations/0002_change_all_referenced_columns.sql')
      await expect(prisma2ndMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- RedefineTables
        PRAGMA defer_foreign_keys=ON;
        PRAGMA foreign_keys=OFF;
        CREATE TABLE "new_Post" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "authorId" INTEGER,
            CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("uid") ON DELETE SET NULL ON UPDATE CASCADE
        );
        INSERT INTO "new_Post" ("authorId", "id") SELECT "authorId", "id" FROM "Post";
        DROP TABLE "Post";
        ALTER TABLE "new_Post" RENAME TO "Post";
        CREATE TABLE "new_User" (
            "uid" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
        );
        DROP TABLE "User";
        ALTER TABLE "new_User" RENAME TO "User";
        PRAGMA foreign_keys=ON;
        PRAGMA defer_foreign_keys=OFF;
        "
      `)

      // Apply `change_all_referenced_columns` migration to D1
      // TODO: Currently failing with `foreign key mismatch - "new_Post" referencing "User"`
      await applyWranglerD1Migration(ctx)
    })

    // See migration_tests::existing_data::primary_key_migrations_do_not_cause_data_loss
    // in https://github.com/prisma/prisma-engines/blob/6e26301fe272ba4ba0598fe43eb5d8df030be4db/schema-engine/sql-migration-tests/tests/existing_data/mod.rs#L784-L866.
    it('migration_tests::existing_data::primary_key_migrations_do_not_cause_data_loss', async () => {
      const cliInstance = MigrateDiff.new('prisma')
      ctx.fixture('schema-sqlite-d1-migrations-do-not-cause-data-loss')

      // Create D1 database
      const wranglerCreateD1 = await executeWranglerD1Command(ctx, { command: 'SELECT 1;' })
      expect(wranglerCreateD1.exitCode).toBe(0)

      // Create `init` migration file for D1 using `wrangler d1 migrations`
      const wranglerCreateInitMigration = await createWranglerD1Migration(ctx, { name: 'init' })
      expect(wranglerCreateInitMigration.exitCode).toBe(0)

      // Create `init` SQL migration using `prisma migrate diff`
      const prismaCreateInitMigration = cliInstance.parse(
        ['--from-empty', '--to-schema', './prisma/schema.prisma', '--script', '--output', './migrations/0001_init.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prismaCreateInitMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `init` SQL migration file
      const initMigrationSQL = ctx.fs.readAsync('./migrations/0001_init.sql')
      await expect(initMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "Dog" (
            "name" TEXT NOT NULL,
            "passportNumber" INTEGER NOT NULL,

            PRIMARY KEY ("name", "passportNumber")
        );

        -- CreateTable
        CREATE TABLE "Puppy" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "motherName" TEXT NOT NULL,
            "motherPassportNumber" INTEGER NOT NULL,
            CONSTRAINT "Puppy_motherName_motherPassportNumber_fkey" FOREIGN KEY ("motherName", "motherPassportNumber") REFERENCES "Dog" ("name", "passportNumber") ON DELETE RESTRICT ON UPDATE CASCADE
        );
        "
      `)

      // Apply `init` migration to D1
      const wranglerExecuteInitMigration = await applyWranglerD1Migration(ctx)
      expect(wranglerExecuteInitMigration.exitCode).toBe(0)

      // Seed some data into D1.

      const wranglerSeedUsers = await executeWranglerD1Command(ctx, {
        command: `INSERT INTO Dog ('name', 'passportNumber') VALUES ('Marnie', 8000);`,
      })
      expect(wranglerSeedUsers.exitCode).toBe(0)

      const wranglerSeedPosts = await executeWranglerD1Command(ctx, {
        command: `INSERT INTO Puppy ('id', 'motherName', 'motherPassportNumber') VALUES ('12345', 'Marnie', 8000);`,
      })
      expect(wranglerSeedPosts.exitCode).toBe(0)

      //
      // Evolve the Prisma data model
      //

      // Create `passport_number_to_string` migration file for D1 using `wrangler d1 migrations`
      const wrangler2ndMigration = await createWranglerD1Migration(ctx, {
        name: 'passport_number_to_string',
      })
      expect(wrangler2ndMigration.exitCode).toBe(0)

      // Switch to D1 config file
      ctx.setConfigFile('d1.config.ts')

      // Create `passport_number_to_string` migration SQL using `prisma migrate diff`
      const prisma2ndMigration = cliInstance.parse(
        [
          '--from-config-datasource',
          '--to-schema',
          './prisma/schema-0002_passport_number_to_string.prisma',
          '--script',
          '--output',
          './migrations/0002_passport_number_to_string.sql',
        ],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prisma2ndMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `passport_number_to_string` SQL migration file
      const prisma2ndMigrationSQL = ctx.fs.readAsync('./migrations/0002_passport_number_to_string.sql')
      await expect(prisma2ndMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- RedefineTables
        PRAGMA defer_foreign_keys=ON;
        PRAGMA foreign_keys=OFF;
        CREATE TABLE "new_Dog" (
            "name" TEXT NOT NULL,
            "passportNumber" TEXT NOT NULL,

            PRIMARY KEY ("name", "passportNumber")
        );
        INSERT INTO "new_Dog" ("name", "passportNumber") SELECT "name", "passportNumber" FROM "Dog";
        DROP TABLE "Dog";
        ALTER TABLE "new_Dog" RENAME TO "Dog";
        CREATE TABLE "new_Puppy" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "motherName" TEXT NOT NULL,
            "motherPassportNumber" TEXT NOT NULL,
            CONSTRAINT "Puppy_motherName_motherPassportNumber_fkey" FOREIGN KEY ("motherName", "motherPassportNumber") REFERENCES "Dog" ("name", "passportNumber") ON DELETE RESTRICT ON UPDATE CASCADE
        );
        INSERT INTO "new_Puppy" ("id", "motherName", "motherPassportNumber") SELECT "id", "motherName", "motherPassportNumber" FROM "Puppy";
        DROP TABLE "Puppy";
        ALTER TABLE "new_Puppy" RENAME TO "Puppy";
        PRAGMA foreign_keys=ON;
        PRAGMA defer_foreign_keys=OFF;
        "
      `)

      // Apply `passport_number_to_string` migration to D1
      await applyWranglerD1Migration(ctx)
    })

    // See `migration_tests::migrations::relations::adding_mutual_references_on_existing_tables_works`
    // in https://github.com/prisma/prisma-engines/blob/main/schema-engine/sql-migration-tests/tests/migrations/relations.rs.
    it.failing('relations::adding_mutual_references_on_existing_tables_works', async () => {
      const cliInstance = MigrateDiff.new('prisma')
      ctx.fixture('schema-sqlite-d1-mutual-references')

      // Create D1 database
      const wranglerCreateD1 = await executeWranglerD1Command(ctx, { command: 'SELECT 1;' })
      expect(wranglerCreateD1.exitCode).toBe(0)

      // Create `init` migration file for D1 using `wrangler d1 migrations`
      const wranglerCreateInitMigration = await createWranglerD1Migration(ctx, { name: 'init' })
      expect(wranglerCreateInitMigration.exitCode).toBe(0)

      // Create `init` SQL migration using `prisma migrate diff`
      const prismaCreateInitMigration = cliInstance.parse(
        ['--from-empty', '--to-schema', './prisma/schema.prisma', '--script', '--output', './migrations/0001_init.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prismaCreateInitMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `init` SQL migration file
      const initMigrationSQL = ctx.fs.readAsync('./migrations/0001_init.sql')
      await expect(initMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "A" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
        );

        -- CreateTable
        CREATE TABLE "B" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
        );
        "
      `)

      // Apply `init` migration to D1
      const wranglerExecuteInitMigration = await applyWranglerD1Migration(ctx)
      expect(wranglerExecuteInitMigration.exitCode).toBe(0)

      //
      // Evolve the Prisma data model
      //

      // Create `add_mutual_references` migration file for D1 using `wrangler d1 migrations`
      const wrangler2ndMigration = await createWranglerD1Migration(ctx, {
        name: 'add_mutual_references',
      })
      expect(wrangler2ndMigration.exitCode).toBe(0)

      // Create `add_mutual_references` migration SQL using `prisma migrate diff`
      const prisma2ndMigration = cliInstance.parse(
        [
          '--from-local-d1',
          '--to-schema',
          './prisma/schema-0002_add_mutual_references.prisma',
          '--script',
          '--output',
          './migrations/0002_add_mutual_references.sql',
        ],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prisma2ndMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `add_mutual_references` SQL migration file
      const prisma2ndMigrationSQL = ctx.fs.readAsync('./migrations/0002_add_mutual_references.sql')
      await expect(prisma2ndMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- RedefineTables
        PRAGMA defer_foreign_keys=ON;
        PRAGMA foreign_keys=OFF;
        CREATE TABLE "new_A" (
            "id" INTEGER NOT NULL,
            "name" TEXT NOT NULL,
            "b_email" TEXT NOT NULL,
            CONSTRAINT "A_b_email_fkey" FOREIGN KEY ("b_email") REFERENCES "B" ("email") ON DELETE NO ACTION ON UPDATE NO ACTION
        );
        INSERT INTO "new_A" ("id") SELECT "id" FROM "A";
        DROP TABLE "A";
        ALTER TABLE "new_A" RENAME TO "A";
        CREATE UNIQUE INDEX "A_name_key" ON "A"("name");
        CREATE TABLE "new_B" (
            "id" INTEGER NOT NULL,
            "email" TEXT NOT NULL,
            "a_name" TEXT NOT NULL,
            CONSTRAINT "B_a_name_fkey" FOREIGN KEY ("a_name") REFERENCES "A" ("name") ON DELETE NO ACTION ON UPDATE NO ACTION
        );
        INSERT INTO "new_B" ("id") SELECT "id" FROM "B";
        DROP TABLE "B";
        ALTER TABLE "new_B" RENAME TO "B";
        CREATE UNIQUE INDEX "B_email_key" ON "B"("email");
        PRAGMA foreign_keys=ON;
        PRAGMA defer_foreign_keys=OFF;
        "
      `)

      // Apply `add_mutual_references` migration to D1
      // TODO: currently fails with `foreign key mismatch - "new_A" referencing "B"`
      await applyWranglerD1Migration(ctx)
    })

    // Based on: https://github.com/prisma/prisma/issues/24208
    it('issue #24208 - broken migrations with relations', async () => {
      const cliInstance = MigrateDiff.new('prisma')
      ctx.fixture('schema-sqlite-d1-24208')

      // Create D1 database
      const wranglerCreateD1 = await executeWranglerD1Command(ctx, { command: 'SELECT 1;' })
      expect(wranglerCreateD1.exitCode).toBe(0)

      // Create `init` migration file for D1 using `wrangler d1 migrations`
      const wranglerCreateInitMigration = await createWranglerD1Migration(ctx, { name: 'init' })
      expect(wranglerCreateInitMigration.exitCode).toBe(0)

      // Create `init` SQL migration using `prisma migrate diff`
      const prismaCreateInitMigration = cliInstance.parse(
        ['--from-empty', '--to-schema', './prisma/schema.prisma', '--script', '--output', './migrations/0001_init.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prismaCreateInitMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `init` SQL migration file
      const initMigrationSQL = ctx.fs.readAsync('./migrations/0001_init.sql')
      await expect(initMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "User" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "email" TEXT NOT NULL,
            "name" TEXT,
            "oldField" TEXT
        );

        -- CreateTable
        CREATE TABLE "Post" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME,
            "title" TEXT NOT NULL,
            "authorId" INTEGER NOT NULL,
            CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        );

        -- CreateIndex
        CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
        "
      `)

      // Apply `init` migration to D1
      const wranglerExecuteInitMigration = await applyWranglerD1Migration(ctx)
      expect(wranglerExecuteInitMigration.exitCode).toBe(0)

      // Seed some data into D1.

      const wranglerSeedUsers = await executeWranglerD1Command(ctx, {
        command: `INSERT INTO User ('id', 'email', 'name') VALUES (1, 'test@test.de', 'Test Test');`,
      })
      expect(wranglerSeedUsers.exitCode).toBe(0)

      const wranglerSeedPosts = await executeWranglerD1Command(ctx, {
        command: `INSERT INTO Post ('id', 'title', 'authorId') VALUES (1, 'Hello World', 1);`,
      })
      expect(wranglerSeedPosts.exitCode).toBe(0)

      //
      // Evolve the Prisma data model
      //

      // Create `rename_new_field` migration file for D1 using `wrangler d1 migrations`
      const wrangler2ndMigration = await createWranglerD1Migration(ctx, { name: 'rename_new_field' })
      expect(wrangler2ndMigration.exitCode).toBe(0)

      // Switch to D1 config file
      ctx.setConfigFile('d1.config.ts')

      // Create `rename_new_field` migration SQL using `prisma migrate diff`
      const prisma2ndMigration = cliInstance.parse(
        [
          '--from-config-datasource',
          '--to-schema',
          './prisma/schema-0002_rename_new_field.prisma',
          '--script',
          '--output',
          './migrations/0002_rename_new_field.sql',
        ],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prisma2ndMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `rename_new_field` SQL migration file
      const prisma2ndMigrationSQL = ctx.fs.readAsync('./migrations/0002_rename_new_field.sql')
      await expect(prisma2ndMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- RedefineTables
        PRAGMA defer_foreign_keys=ON;
        PRAGMA foreign_keys=OFF;
        CREATE TABLE "new_User" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "email" TEXT NOT NULL,
            "name" TEXT,
            "newField" TEXT
        );
        INSERT INTO "new_User" ("createdAt", "email", "id", "name") SELECT "createdAt", "email", "id", "name" FROM "User";
        DROP TABLE "User";
        ALTER TABLE "new_User" RENAME TO "User";
        CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
        PRAGMA foreign_keys=ON;
        PRAGMA defer_foreign_keys=OFF;
        "
      `)

      // Apply `rename_new_field` migration to D1
      await applyWranglerD1Migration(ctx)
    })

    it('incremental changes succeed until foreign keys are violated', async () => {
      const cliInstance = MigrateDiff.new('prisma')
      ctx.fixture('schema-sqlite-d1')

      // Create D1 database
      const wranglerCreateD1 = await executeWranglerD1Command(ctx, { command: 'SELECT 1;' })
      expect(wranglerCreateD1.exitCode).toBe(0)

      // Create `init` migration file for D1 using `wrangler d1 migrations`
      const wranglerCreateInitMigration = await createWranglerD1Migration(ctx, { name: 'init' })
      expect(wranglerCreateInitMigration.exitCode).toBe(0)

      // Create `init` SQL migration using `prisma migrate diff`
      const prismaCreateInitMigration = cliInstance.parse(
        ['--from-empty', '--to-schema', './prisma/schema.prisma', '--script', '--output', './migrations/0001_init.sql'],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prismaCreateInitMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `init` SQL migration file
      const initMigrationSQL = ctx.fs.readAsync('./migrations/0001_init.sql')
      await expect(initMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- CreateTable
        CREATE TABLE "Post" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "title" TEXT NOT NULL,
            "content" TEXT,
            "published" BOOLEAN NOT NULL DEFAULT false,
            "authorId" INTEGER NOT NULL,
            CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        );

        -- CreateTable
        CREATE TABLE "User" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "email" TEXT NOT NULL,
            "name" TEXT
        );

        -- CreateIndex
        CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
        "
      `)

      // Apply `init` migration to D1
      const wranglerExecuteInitMigration = await applyWranglerD1Migration(ctx)
      expect(wranglerExecuteInitMigration.exitCode).toBe(0)

      //
      // Evolve the Prisma data model
      //

      // Create `add_count_to_user_table` migration file for D1 using `wrangler d1 migrations`
      const wrangler2ndMigration = await createWranglerD1Migration(ctx, { name: 'add_count_to_user_table' })
      expect(wrangler2ndMigration.exitCode).toBe(0)

      // Switch to D1 config file
      ctx.setConfigFile('d1.config.ts')

      // Create `add_count_to_user_table` migration SQL using `prisma migrate diff`
      const prisma2ndMigration = cliInstance.parse(
        [
          '--from-config-datasource',
          '--to-schema',
          './prisma/schema-0002_add_count_to_user_table.prisma',
          '--script',
          '--output',
          './migrations/0002_add_count_to_user_table.sql',
        ],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prisma2ndMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `add_count_to_user_table` SQL migration file
      const prisma2ndMigrationSQL = ctx.fs.readAsync('./migrations/0002_add_count_to_user_table.sql')
      await expect(prisma2ndMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- RedefineTables
        PRAGMA defer_foreign_keys=ON;
        PRAGMA foreign_keys=OFF;
        CREATE TABLE "new_User" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "email" TEXT NOT NULL,
            "name" TEXT,
            "count" INTEGER NOT NULL
        );
        INSERT INTO "new_User" ("email", "id", "name") SELECT "email", "id", "name" FROM "User";
        DROP TABLE "User";
        ALTER TABLE "new_User" RENAME TO "User";
        CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
        PRAGMA foreign_keys=ON;
        PRAGMA defer_foreign_keys=OFF;
        "
      `)

      // Apply `add_count_to_user_table` migration to D1
      const wranglerExecute2ndMigration = await applyWranglerD1Migration(ctx)
      expect(wranglerExecute2ndMigration.exitCode).toBe(0)

      // Seed some data into D1.
      // Once we move the `PRIMARY KEY` from `User.id` to `User.count`, we would like to observe the `FOREIGN KEY` constraint failure,
      // demonstrating that Prisma migrations check the integrity of the data, and rollback the migration if the data is not consistent.

      const wranglerSeedUsers = await executeWranglerD1Command(ctx, {
        command: `INSERT INTO User ('id', 'count', 'email', 'name') VALUES (1, 2, 'schiabel@prisma.io', 'Schiabel');`,
      })
      expect(wranglerSeedUsers.exitCode).toBe(0)

      const wranglerSeedPosts = await executeWranglerD1Command(ctx, {
        command: `INSERT INTO Post ('id', 'title', 'authorId') VALUES (1, 'Post 1', '1');`,
      })
      expect(wranglerSeedPosts.exitCode).toBe(0)

      // Create `change_user_id_to_count` migration file for D1 using `wrangler d1 migrations`
      const wrangler3dMigration = await createWranglerD1Migration(ctx, {
        name: 'change_user_id_to_count',
      })
      expect(wrangler3dMigration.exitCode).toBe(0)

      // Create `add_count_to_user_table` migration SQL using `prisma migrate diff`
      const prisma3dMigration = cliInstance.parse(
        [
          '--from-config-datasource',
          '--to-schema',
          './prisma/schema-0003_change_user_id_to_count.prisma',
          '--script',
          '--output',
          './migrations/0003_change_user_id_to_count.sql',
        ],
        await ctx.config(),
        ctx.configDir(),
      )
      await expect(prisma3dMigration).resolves.toMatchInlineSnapshot(`""`)

      // Print the `add_count_to_user_table` SQL migration file.
      const prisma3dMigrationSQL = ctx.fs.readAsync('./migrations/0003_change_user_id_to_count.sql')
      await expect(prisma3dMigrationSQL).resolves.toMatchInlineSnapshot(`
        "-- RedefineTables
        PRAGMA defer_foreign_keys=ON;
        PRAGMA foreign_keys=OFF;
        CREATE TABLE "new_Post" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "title" TEXT NOT NULL,
            "content" TEXT,
            "published" BOOLEAN NOT NULL DEFAULT false,
            "authorId" INTEGER NOT NULL,
            CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("count") ON DELETE RESTRICT ON UPDATE CASCADE
        );
        INSERT INTO "new_Post" ("authorId", "content", "id", "published", "title") SELECT "authorId", "content", "id", "published", "title" FROM "Post";
        DROP TABLE "Post";
        ALTER TABLE "new_Post" RENAME TO "Post";
        CREATE TABLE "new_User" (
            "id" INTEGER NOT NULL,
            "email" TEXT NOT NULL,
            "name" TEXT,
            "count" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
        );
        INSERT INTO "new_User" ("count", "email", "id", "name") SELECT "count", "email", "id", "name" FROM "User";
        DROP TABLE "User";
        ALTER TABLE "new_User" RENAME TO "User";
        CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
        PRAGMA foreign_keys=ON;
        PRAGMA defer_foreign_keys=OFF;
        "
      `)

      // Apply `add_count_to_user_table` migration to D1
      try {
        await applyWranglerD1Migration(ctx)
        expect(true).toBe(false) // unreachable
      } catch (error) {
        const e = error as ExecaError

        // There are two possible `FOREIGN KEY` constraint failure messages that could appear, depending on the order of the output of `prisma migrate diff`.
        const possibleMatches = [
          'FOREIGN KEY constraint failed',
          'foreign key mismatch - "new_Post" referencing "User"',
        ]
        expect(possibleMatches.some((match) => e.stderr.includes(match))).toBe(true)
      }

      // Verify that the `User` table is still in the original state, i.e., that a `ROLLBACK` of the previous migration has occurred.
      const wranglerVerifyUserTable = await executeWranglerD1Command(ctx, {
        command: 'PRAGMA table_info(User);',
        json: true,
      })

      const wranglerVerifyUserTableAsJSON = JSON.parse(wranglerVerifyUserTable.stdout)
      expect(wranglerVerifyUserTableAsJSON).toMatchObject([
        {
          results: [
            {
              cid: 0,
              name: 'id',
              type: 'INTEGER',
              notnull: 1,
              dflt_value: 'null',
              pk: 1,
            },
            {
              cid: 1,
              name: 'email',
              type: 'TEXT',
              notnull: 1,
              dflt_value: 'null',
              pk: 0,
            },
            {
              cid: 2,
              name: 'name',
              type: 'TEXT',
              notnull: 0,
              dflt_value: 'null',
              pk: 0,
            },
            {
              cid: 3,
              name: 'count',
              type: 'INTEGER',
              notnull: 1,
              dflt_value: 'null',
              pk: 0,
            },
          ],
          success: true,
        },
      ])
    })
  })
})
