// describeMatrix making eslint unhappy about the test names
/* eslint-disable jest/no-identical-title */

import fs from 'fs-jetpack'
import path from 'path'
import prompt from 'prompts'

import { DbExecute } from '../commands/DbExecute'
import { MigrateDev } from '../commands/MigrateDev'
import { MigrateReset } from '../commands/MigrateReset'
import { setupCockroach, tearDownCockroach } from '../utils/setupCockroach'
import { setupMSSQL, tearDownMSSQL } from '../utils/setupMSSQL'
import { setupMysql, tearDownMysql } from '../utils/setupMysql'
import type { SetupParams } from '../utils/setupPostgres'
import { runQueryPostgres, setupPostgres, tearDownPostgres } from '../utils/setupPostgres'
import {
  cockroachdbOnly,
  describeMatrix,
  postgresOnly,
  sqliteOnly,
  sqlServerOnly,
} from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const testIf = (condition: boolean) => (condition ? test : test.skip)

const ctx = createDefaultTestContext()

beforeEach(() => {
  clearPromptInjection('before')
  // Disable prompts
  process.env.GITHUB_ACTIONS = '1'
})

afterEach(() => {
  clearPromptInjection('after')
})

// Sanity check to ensure no prompt injections remain enqueued between
// test cases. Having those would cause cascade failures of unrelated
// test cases after failed ones with confusing error output, wasting
// developer's time. This is why we should not rely on such global objects
// if possible.
function clearPromptInjection(position: string): void {
  if (!prompt || !prompt._injected) return

  const count = prompt._injected.length
  if (!count) return

  process.stdout.write(
    `WARNING: Clearing ${count} prompt injection(s) ${position} test case\n: ${prompt._injected.join(', ')}`,
  )

  prompt._injected.splice(0, count)
}

describe('prisma.config.ts', () => {
  it('should require a datasource in the config', async () => {
    ctx.fixture('no-config')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"The datasource.url property is required in your Prisma config file when using prisma migrate dev."`,
    )
  })
})

describe('common', () => {
  it('invalid schema', async () => {
    expect.assertions(2)
    ctx.fixture('schema-only-sqlite')
    ctx.setConfigFile('invalid.config.ts')

    try {
      await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
      expect(true).toBe(false) // unreachable
    } catch (error) {
      expect(error.message).toMatchInlineSnapshot(`
        "Prisma schema validation - (get-config wasm)
        Error code: P1012
        error: Error validating: This line is invalid. It does not start with any known Prisma schema keyword.
          -->  prisma/invalid.prisma:9
           | 
         8 | }
         9 | model Blog {
        10 | 
           | 

        Validation Error Count: 1
        [Context: getConfig]

        Prisma CLI Version : 0.0.0"
      `)
    }

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)
  })

  it('provider array should fail', async () => {
    expect.assertions(2)
    ctx.fixture('schema-only-sqlite')
    ctx.setConfigFile('provider-array.config.ts')

    try {
      await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
      expect(true).toBe(false) // unreachable
    } catch (error) {
      expect(error.message).toMatchInlineSnapshot(`
        "Prisma schema validation - (get-config wasm)
        Error code: P1012
        error: Error validating datasource \`my_db\`: The provider argument in a datasource must be a string literal
          -->  prisma/provider-array.prisma:2
           | 
         1 | datasource my_db {
         2 |     provider = ["postgresql", "sqlite"]
           | 

        Validation Error Count: 1
        [Context: getConfig]

        Prisma CLI Version : 0.0.0"
      `)
    }
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)
  })

  it('wrong flag', async () => {
    const commandInstance = MigrateDev.new('prisma')
    const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

    await commandInstance.parse(['--something'], await ctx.config(), ctx.configDir())
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('help flag', async () => {
    const commandInstance = MigrateDev.new('prisma')
    const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

    await commandInstance.parse(['--help'], await ctx.config(), ctx.configDir())
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('should fail if no schema file', async () => {
    ctx.fixture('empty')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "Could not find Prisma Schema that is required for this command.
      You can either provide it with \`--schema\` argument,
      set it in your Prisma Config file (e.g., \`prisma7.config.ts\`),
      set it as \`prisma.schema\` in your package.json,
      or put it into the default location (\`./prisma/schema.prisma\`, or \`./schema.prisma\`.
      Checked following paths:

      schema.prisma: file not found
      prisma/schema.prisma: file not found

      See also https://pris.ly/d/prisma-schema-location"
    `)
  })
  it('dev should error in unattended environment', async () => {
    // Must use a fixture which attempts to prompt
    ctx.fixture('existing-db-1-warning')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`
      "Prisma Migrate has detected that the environment is non-interactive, which is not supported.

      \`prisma migrate dev\` is an interactive command designed to create new migrations and evolve the database in development.
      To apply existing migrations in deployments, use prisma migrate deploy.
      See https://pris.ly/d/migrate-deploy"
    `)
  })
})

describeMatrix(sqliteOnly, 'SQLite', () => {
  it('empty schema', async () => {
    ctx.fixture('schema-only-sqlite')
    ctx.setConfigFile('empty.config.ts')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Already in sync, no schema change or pending migration was found.
      "
    `)
  })

  it('should work with nested config and schema', async () => {
    ctx.fixture('prisma-config-nested-sqlite')
    ctx.setConfigFile('config/prisma.config.ts')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      config/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('--url overrides config datasource URL when datasource exists in config', async () => {
    ctx.fixture('schema-only-sqlite')
    ctx.setDatasource({
      url: 'file:./other.db',
    })

    const result = MigrateDev.new('prisma').parse(
      ['--name=first', '--url=file:./dev.db'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('--url works when no datasource exists in config', async () => {
    ctx.fixture('schema-only-sqlite')
    // Don't set datasource - test that --url creates it

    const result = MigrateDev.new('prisma').parse(
      ['--name=first', '--url=file:./dev.db'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('first migration (--name)', async () => {
    ctx.fixture('schema-only-sqlite')
    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(fs.exists('prisma/migrations/migration_lock.toml')).toEqual('file')

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('first migration (--name) (folder)', async () => {
    ctx.fixture('schema-folder-sqlite')
    ctx.setConfigFile('schema.config.ts')
    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(fs.exists('prisma/schema/migrations/migration_lock.toml')).toEqual('file')

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/schema/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  //
  // TODO: Windows: test fails with:
  //
  // [Error: Failed to create a new migration directory.
  //    0: migration_core::api::CreateMigration
  //            with migration_name="xl556ba8iva0gd2qfoyk2fvifsysnq7c766sscsa18rwolofgwo6j1mwc4d5xhgmkfumr8ktberb1y177de7uxcd6v7l44b6fkhlwycl70lrxw0u7h6bdpuf595n046bp9ek87dk59o0nlruto403n7esdq6wgm3o5w425i7svaw557latsslakyjifkd1p21jwj1end" draft=false
  //              at schema-engine\core\src\api.rs:94
  // ]
  //
  // Probably the file name is too long for Windows?
  //
  testIf(process.platform !== 'win32')('first migration (prompt)', async () => {
    ctx.fixture('schema-only-sqlite')

    prompt.inject([
      'xl556ba8iva0gd2qfoyk2fvifsysnq7c766sscsa18rwolofgwo6j1mwc4d5xhgmkfumr8ktberb1y177de7uxcd6v7l44b6fkhlwycl70lrxw0u7h6bdpuf595n046bp9ek87dk59o0nlruto403n7esdq6wgm3o5w425i7svaw557latsslakyjifkd1p21jwj1end_this_should_be_truncated',
    ])

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Enter a name for the new migration:

      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_xl556ba8iva0gd2qfoyk2fvifsysnq7c766sscsa18rwolofgwo6j1mwc4d5xhgmkfumr8ktberb1y177de7uxcd6v7l44b6fkhlwycl70lrxw0u7h6bdpuf595n046bp9ek87dk59o0nlruto403n7esdq6wgm3o5w425i7svaw557latsslakyjifkd1p21jwj1end/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  // it('first migration --name --force', async () => {
  //   ctx.fixture('schema-only-sqlite')
  //   const result = MigrateDev.new('prisma').parse([
  //     '--name=first',
  //     '--force',
  //
  //   ])

  //   await expect(result).resolves.toMatchInlineSnapshot(
  //     `Everything is now in sync.`,
  //   )
  //   expect(ctx.normalizedCapturedStdout())
  //     .toMatchInlineSnapshot(`
  //     Prisma schema loaded from prisma/schema.prisma

  //     SQLite database dev.db created at file:dev.db

  //     The following migration(s) have been created and applied from new schema changes:

  //     prisma/migrations/
  //       └─ 20201231000000_first/
  //         └─ migration.sql

  //   `)
  // })

  it('snapshot of sql', async () => {
    ctx.fixture('schema-only-sqlite')

    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    const baseDir = path.join('prisma', 'migrations')
    const migrationDirList = fs.list(baseDir)
    const migrationFilePath = path.join(baseDir, migrationDirList![0], 'migration.sql')
    const migrationFile = fs.read(migrationFilePath)
    expect(migrationFile).toMatchInlineSnapshot(`
      "-- CreateTable
      CREATE TABLE "Blog" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "viewCount20" INTEGER NOT NULL
      );
      "
    `)
  })

  it('first migration (non-interactive)', async () => {
    ctx.fixture('schema-only-sqlite')
    // Unset the CI env vars from setup.ts and beforeEach, only the TTY check should skip the prompt
    delete process.env.CI
    delete process.env.GITHUB_ACTIONS
    // To make sure the terminal is always detected
    // as non interactive, locally and in CI
    process.env.TERM = 'dumb'

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('draft migration and apply (prompt)', async () => {
    ctx.fixture('schema-only-sqlite')

    prompt.inject(['some-Draft'])

    const draftResult = MigrateDev.new('prisma').parse(['--create-only'], await ctx.config(), ctx.configDir())

    await expect(draftResult).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000_some_draft

      You can now edit it and apply it by running prisma migrate dev."
    `)

    const applyResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(applyResult).resolves.toMatchInlineSnapshot(`""`)

    expect((fs.list('prisma/migrations')?.length || 0) > 0).toMatchInlineSnapshot(`true`)
    expect(fs.exists('dev.db')).toEqual('file')
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Enter a name for the new migration:
      Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_some_draft/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('draft migration with empty schema (prompt)', async () => {
    ctx.fixture('schema-only-sqlite')

    prompt.inject(['some-empty-Draft'])

    ctx.setConfigFile('empty.config.ts')
    const draftResult = MigrateDev.new('prisma').parse(['--create-only'], await ctx.config(), ctx.configDir())

    await expect(draftResult).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000_some_empty_draft

      You can now edit it and apply it by running prisma migrate dev."
    `)

    expect((fs.list('prisma/migrations')?.length || 0) > 0).toMatchInlineSnapshot(`true`)
    expect(fs.exists('dev.db')).toEqual('file')
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Enter a name for the new migration:
      "
    `)
  })

  it('draft migration and apply (--name)', async () => {
    ctx.fixture('schema-only-sqlite')
    const draftResult = MigrateDev.new('prisma').parse(
      ['--create-only', '--name=first'],
      await ctx.config(),
      ctx.configDir(),
    )

    await expect(draftResult).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000_first

      You can now edit it and apply it by running prisma migrate dev."
    `)

    const applyResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(applyResult).resolves.toMatchInlineSnapshot(`""`)
    expect((fs.list('prisma/migrations')?.length || 0) > 0).toMatchInlineSnapshot(`true`)
    expect(fs.exists('dev.db')).toEqual('file')
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('transition-db-push-migrate (refuses to reset)', async () => {
    ctx.fixture('transition-db-push-migrate')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 130"`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Drift detected: Your database schema is not in sync with your migration history.

      The following is a summary of the differences between the expected database schema given your migrations files, and the actual schema of the database.

      It should be understood as the set of changes to get from the expected schema to the actual schema.

      If you are running this the first time on an existing database, please make sure to read this documentation page:
      https://www.prisma.io/docs/guides/database/developing-with-prisma-migrate/troubleshooting-development

      [+] Added tables
        - Blog
        - _Migration

      We need to reset the SQLite database "dev.db" at "file:dev.db"

      You may use prisma migrate reset to drop the development database.
      All data will be lost.
      "
    `)
    expect(ctx.recordedExitCode()).toEqual(130)
  })

  it('edited migration and unapplied empty draft', async () => {
    ctx.fixture('edited-and-draft')

    // migrate reset --force
    const migrateReset = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(migrateReset).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Database reset successful

      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_test/
          └─ migration.sql
        └─ 20201231000000_draft/
          └─ migration.sql
      "
    `)
    ctx.clearCapturedStdout()

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Already in sync, no schema change or pending migration was found.
      "
    `)
  })

  it('removed applied migration and unapplied empty draft', async () => {
    ctx.fixture('edited-and-draft')
    fs.remove('prisma/migrations/20201117144659_test')

    // migrate reset --force
    const migrateReset = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(migrateReset).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Database reset successful

      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_draft/
          └─ migration.sql
      "
    `)
    ctx.clearCapturedStdout()

    prompt.inject(['new-change'])

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Enter a name for the new migration:

      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_new_change/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('broken migration should fail', async () => {
    ctx.fixture('broken-migration')

    try {
      await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    } catch (e) {
      expect(e.code).toEqual('P3006')
      expect(e.message).toContain('near "BROKEN": syntax error')
    }

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      "
    `)
  })

  it('existingdb: has a failed migration', async () => {
    ctx.fixture('existing-db-1-failed-migration')

    try {
      await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    } catch (e) {
      expect(e.code).toEqual('P3006')
      expect(e.message).toContain('P3006')
      expect(e.message).toContain('failed to apply cleanly to the shadow database.')
    }

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      "
    `)
  })

  it('existing-db-1-migration edit migration with broken sql', async () => {
    ctx.fixture('existing-db-1-migration')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    // Edit with broken SQL
    fs.write('prisma/migrations/20201014154943_init/migration.sql', 'CREATE BROKEN')

    try {
      await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    } catch (e) {
      expect(e.code).toEqual('P3006')
      expect(e.message).toContain('P3006')
      expect(e.message).toContain('failed to apply cleanly to the shadow database.')
    }

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Already in sync, no schema change or pending migration was found.
      Datasource "my_db": SQLite database "dev.db" <location placeholder>

      "
    `)
  })

  it('existingdb: 1 unapplied draft', async () => {
    ctx.fixture('existing-db-1-draft')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_draft/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('existingdb: 1 unapplied draft + 1 schema change', async () => {
    ctx.fixture('existing-db-1-draft-1-change')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_draft/
          └─ migration.sql


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('existingdb: 1 unexecutable schema change', async () => {
    ctx.fixture('existing-db-1-unexecutable-schema-change')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).rejects.toMatchInlineSnapshot(`
      "
      ⚠️ We found changes that cannot be executed:

        • Step 0 Made the column \`fullname\` on table \`Blog\` required, but there are 1 existing NULL values.

      You can use prisma migrate dev --create-only to create the migration file, and manually modify it to address the underlying issue(s).
      Then run prisma migrate dev to apply it and verify it works.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      "
    `)
  })

  it('existingdb: 1 unexecutable schema change with --create-only should succeed', async () => {
    ctx.fixture('existing-db-1-unexecutable-schema-change')
    const result = MigrateDev.new('prisma').parse(['--create-only'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000

      You can now edit it and apply it by running prisma migrate dev."
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "
      ⚠️ We found changes that cannot be executed:

        • Step 0 Made the column \`fullname\` on table \`Blog\` required, but there are 1 existing NULL values.
      "
    `)
  })

  it('existingdb: 1 warning from schema change (prompt yes)', async () => {
    ctx.fixture('existing-db-1-warning')

    prompt.inject(['y'])

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      ⚠️  Warnings for the current datasource:

        • You are about to drop the \`Blog\` table, which is not empty (2 rows).


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('existingdb: 1 warning from schema change (prompt no)', async () => {
    ctx.fixture('existing-db-1-warning')

    prompt.inject([new Error()])

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 130"`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      ⚠️  Warnings for the current datasource:

        • You are about to drop the \`Blog\` table, which is not empty (2 rows).

      Migration cancelled.
      "
    `)
    expect(ctx.recordedExitCode()).toEqual(130)
  })

  test('one seed.ts file in prisma.config.ts', async () => {
    ctx.fixture('seed-from-prisma-config/seed-sqlite-ts')

    prompt.inject(['y'])

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      Enter a name for the new migration:

      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_y/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('provider switch: postgresql to sqlite', async () => {
    ctx.fixture('provider-switch-postgresql-to-sqlite')

    try {
      await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    } catch (e) {
      expect(e.code).toEqual('P3019')
      expect(e.message).toContain('P3019')
      expect(e.message).toContain('The datasource provider')
    }

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      "
    `)
  })
})

describeMatrix(postgresOnly, 'postgres', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace('tests-migrate', 'tests-migrate-dev')

  const setupParams: SetupParams = {
    connectionString,
    dirname: '',
  }

  beforeAll(async () => {
    await tearDownPostgres(setupParams).catch((e) => {
      console.error(e)
    })
  })

  beforeEach(async () => {
    await setupPostgres(setupParams).catch((e) => {
      console.error(e)
    })

    const shadowDatabaseUrl = connectionString.replace('tests-migrate-dev', 'tests-migrate-dev-shadowdb')
    ctx.setDatasource({ url: connectionString, shadowDatabaseUrl })
  })

  afterEach(async () => {
    await tearDownPostgres(setupParams).catch((e) => {
      console.error(e)
    })
  })

  it('schema only', async () => {
    ctx.fixture('schema-only-postgresql')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/schema.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('schema only with shadowdb', async () => {
    ctx.fixture('schema-only-postgresql')

    ctx.setConfigFile('shadowdb.config.ts')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/shadowdb.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('create first migration', async () => {
    ctx.fixture('schema-only-postgresql')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/schema.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('create first migration with nativeTypes', async () => {
    ctx.fixture('nativeTypes-postgresql')

    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/schema.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  // it('first migration --force + --name', async () => {
  //   ctx.fixture('schema-only-postgresql')
  //   const result = MigrateDev.new('prisma').parse([
  //     '--name=first',
  //     '--force',
  //   ])

  //   await expect(result).resolves.toMatchInlineSnapshot(
  //     `Everything is now in sync.`,
  //   )
  //   expect(ctx.normalizedCapturedStdout())
  //     .toMatchInlineSnapshot(`
  //     Prisma schema loaded from prisma/schema.prisma
  //     The following migration(s) have been created and applied from new schema changes:

  //     prisma/migrations/
  //       └─ 20201231000000_first/
  //         └─ migration.sql

  //   `)
  // })

  it('draft migration and apply (--name)', async () => {
    ctx.fixture('schema-only-postgresql')
    jest.setTimeout(7_000)

    const draftResult = MigrateDev.new('prisma').parse(
      ['--create-only', '--name=first'],
      await ctx.config(),
      ctx.configDir(),
    )

    await expect(draftResult).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000_first

      You can now edit it and apply it by running prisma migrate dev."
    `)

    const applyResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(applyResult).resolves.toMatchInlineSnapshot(`""`)

    expect((fs.list('prisma/migrations')?.length || 0) > 0).toMatchInlineSnapshot(`true`)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/schema.prisma.
      Prisma schema loaded from prisma/schema.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>

      Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('existingdb: create first migration', async () => {
    ctx.fixture('schema-only-postgresql')
    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/schema.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  // it('real-world-grading-app: compare snapshot', async () => {
  //   ctx.fixture('real-world-grading-app')
  //   const result = MigrateDev.new('prisma').parse([])

  //   await expect(result).resolves.toMatchInlineSnapshot()
  //   expect(ctx.normalizedCapturedStdout())
  //     .toMatchInlineSnapshot(`
  //     Prisma Schema loaded from prisma/schema.prisma

  //     Prisma Migrate applied the following migration(s):

  //     migrations/
  //       └─ 20201231000000/
  //         └─ migration.sql
  //   `)

  //   expect(
  //     fs.read(`prisma/${fs.list('prisma/migrations')![0]}/migration.sql`),
  //   ).toEqual([])
  // })

  // TODO in follow-up PR make it passing reliably in CI
  // Failed with
  // Snapshot: db error: ERROR: relation "_prisma_migrations" already exists
  // 0: migration_core::state::ApplyMigrations
  // at schema-engine/core/src/state.rs:199
  // Probably needs to run on an isolated db (currently in a git stash)
  it.skip('need to reset prompt: (no) should succeed', async () => {
    ctx.fixture('schema-only-postgresql')

    await fs.writeAsync(
      'script.sql',
      `CREATE TABLE "public"."User"
       (
           "id"    text,
           "email" text NOT NULL,
           "name"  text,
           PRIMARY KEY ("id")
       );`,
    )

    const dbExecuteResult = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
    await expect(dbExecuteResult).resolves.toMatchInlineSnapshot(`Script executed successfully.`)

    prompt.inject(['test', new Error()]) // simulate user cancellation
    // prompt.inject(['y']) // simulate user cancellation

    ctx.setConfigFile('multiSchema.config.ts')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`
      db error: ERROR: relation "_prisma_migrations" already exists
         0: migration_core::state::ApplyMigrations
                   at schema-engine/core/src/state.rs:199

    `)
    expect(ctx.recordedExitCode()).toEqual(130)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot()
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      Environment variables loaded from prisma/.env
      Prisma schema loaded from prisma/multiSchema.prisma
      Datasource "my_db": PostgreSQL database "tests-migrate-dev", schemas "schema1, schema2" at "localhost:5432"

      Enter a name for the new migration:
    `)
    // expect(ctx.mocked['console.log'].mock.calls.join()).toMatchInlineSnapshot(`Canceled by user.`)
  })

  it('regression: enum array column type is introspected properly (gh-22456)', async () => {
    ctx.fixture('enum-array-type-introspection')

    // Reset the database
    const reset = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(reset).resolves.toMatchInlineSnapshot('""')

    // The first (initial) migration should create the database objects
    ctx.clearCapturedStdout()
    const firstResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(firstResult).resolves.toMatchInlineSnapshot('""')
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)

    // No migration should be created on the second run, since there have been no changes to the schema
    ctx.clearCapturedStdout()
    const secondResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(secondResult).resolves.toMatchInlineSnapshot('""')
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>

      Already in sync, no schema change or pending migration was found.
      "
    `)
  })

  // TODO: for some reason this test fails on macOS on CI:
  //
  // ```
  // FAIL src/__tests__/MigrateDev.test.ts (20.107 s)
  // ● postgres › external tables
  //
  //   expect(received).resolves.toMatchInlineSnapshot()
  //
  //   Received promise rejected instead of resolved
  //   Rejected to value: [Error: ERROR: relation "User" already exists
  //      0: sql_schema_connector::validate_migrations
  //              with namespaces=None filter=SchemaFilter { external_tables: ["public.User"], external_enums: [] }
  //                at schema-engine/connectors/sql-schema-connector/src/lib.rs:538
  //      1: schema_core::state::DevDiagnostic
  //                at schema-engine/core/src/state.rs:319
  //   ]
  //
  //     1117 |     // Only external tables in the schema => no migration needed
  //     1118 |     const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
  //   > 1119 |     await expect(result).resolves.toMatchInlineSnapshot(`""`)
  //          |           ^
  //     1120 |     expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
  //     1121 |       "Prisma schema loaded from schema.prisma
  //     1122 |       Datasource "db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>
  //
  //     at expect (../../node_modules/.pnpm/expect@29.7.0/node_modules/expect/build/index.js:113:15)
  //     at Object.expect (src/__tests__/MigrateDev.test.ts:1119:11)
  //
  // ```
  //
  // However, it passes on Linux and Windows on CI, as well as on macOS locally.
  //
  // Investigation ticket: https://linear.app/prisma-company/issue/TML-1544/investigate-migrate-dev-external-tables-test-on-macos-on-ci
  testIf(!process.env.CI || process.platform !== 'darwin')('external tables', async () => {
    ctx.fixture('external-tables')

    // Only external tables in the schema => no migration needed
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>

      Already in sync, no schema change or pending migration was found.
      "
    `)
    // Create external table in actual database so it can be referenced later
    const { url } = (await ctx.datasource())!
    await runQueryPostgres(
      { connectionString: url },
      `
      CREATE TABLE "User" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL
      )
    `,
    )

    // Create migration based of updated schema that has a relation towards the external table.
    // `initShadowDb` from prisma.config.ts is used to create the external table in the shadow database for diffing.
    ctx.setConfigFile('schema_relation.config.ts')
    const result2 = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())
    await expect(result2).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>

      Already in sync, no schema change or pending migration was found.
      Datasource "db": PostgreSQL database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)

    // Check that we really only have the migration for non-external tables but reference the external table via the foreign key.
    const migrationSqlFile = `migrations/${(ctx.fs.list('migrations') || [])[0]}/migration.sql`
    expect(ctx.fs.read(migrationSqlFile)).toMatchInlineSnapshot(`
      "-- CreateTable
      CREATE TABLE "Order" (
          "id" INTEGER NOT NULL,
          "userId" INTEGER NOT NULL,

          CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
      );

      -- AddForeignKey
      ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      "
    `)
  })
})

describeMatrix(cockroachdbOnly, 'cockroachdb', () => {
  if (!process.env.TEST_SKIP_COCKROACHDB && !process.env.TEST_COCKROACH_URI_MIGRATE) {
    throw new Error('You must set a value for process.env.TEST_COCKROACH_URI_MIGRATE. See TESTING.md')
  }
  const connectionString = process.env.TEST_COCKROACH_URI_MIGRATE!.replace('tests-migrate', 'tests-migrate-dev')

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

    const shadowDatabaseUrl = connectionString.replace('tests-migrate-dev', 'tests-migrate-dev-shadowdb')
    ctx.setDatasource({ url: connectionString, shadowDatabaseUrl })
  })

  afterEach(async () => {
    await tearDownCockroach(setupParams).catch((e) => {
      console.error(e)
    })
  })

  it('schema only', async () => {
    ctx.fixture('schema-only-cockroachdb')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": CockroachDB database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('schema only with shadowdb', async () => {
    ctx.fixture('schema-only-cockroachdb')

    ctx.setConfigFile('shadowdb.config.ts')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": CockroachDB database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('create first migration', async () => {
    ctx.fixture('schema-only-cockroachdb')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": CockroachDB database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('create first migration with nativeTypes', async () => {
    ctx.fixture('nativeTypes-cockroachdb')

    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": CockroachDB database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  }, 40_000)

  it('draft migration and apply (--name)', async () => {
    ctx.fixture('schema-only-cockroachdb')
    jest.setTimeout(7_000)

    const draftResult = MigrateDev.new('prisma').parse(
      ['--create-only', '--name=first'],
      await ctx.config(),
      ctx.configDir(),
    )

    await expect(draftResult).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000_first

      You can now edit it and apply it by running prisma migrate dev."
    `)

    const applyResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(applyResult).resolves.toMatchInlineSnapshot(`""`)

    expect((fs.list('prisma/migrations')?.length || 0) > 0).toMatchInlineSnapshot(`true`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": CockroachDB database "tests-migrate-dev", schema "public" <location placeholder>

      Datasource "db": CockroachDB database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('existingdb: create first migration', async () => {
    ctx.fixture('schema-only-cockroachdb')
    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": CockroachDB database "tests-migrate-dev", schema "public" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })
})

describeMatrix({ providers: { mysql: true } }, 'mysql', () => {
  const connectionString = process.env.TEST_MYSQL_URI_MIGRATE!.replace('tests-migrate', 'tests-migrate-dev')

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

    const shadowDatabaseUrl = connectionString.replace('tests-migrate-dev', 'tests-migrate-dev-shadowdb')
    ctx.setDatasource({ url: connectionString, shadowDatabaseUrl })
  })

  afterEach(async () => {
    await tearDownMysql(setupParams).catch((e) => {
      console.error(e)
    })
  })

  it('schema only', async () => {
    ctx.fixture('schema-only-mysql')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MySQL database "tests-migrate-dev" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('schema only with shadowdb', async () => {
    ctx.fixture('schema-only-mysql')

    ctx.setConfigFile('shadowdb.config.ts')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MySQL database "tests-migrate-dev" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('create first migration', async () => {
    ctx.fixture('schema-only-mysql')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MySQL database "tests-migrate-dev" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  // it('create first migration with nativeTypes', async () => {
  //   ctx.fixture('nativeTypes-mysql')

  //   const result = MigrateDev.new('prisma').parse(['--name=first'])
  //   await expect(result).resolves.toMatchInlineSnapshot(``)

  //   expect(ctx.normalizedCapturedStdout())
  //     .toMatchInlineSnapshot(`
  //     Prisma schema loaded from prisma/schema.prisma
  //     Datasource "db": PostgreSQL database "tests-migrate", schema "public" at "localhost:5432"

  //     The following migration(s) have been created and applied from new schema changes:

  //     prisma/migrations/
  //       └─ 20201231000000_first/
  //         └─ migration.sql

  //     Your database is now in sync with your schema.
  //   `)
  // })

  // it('first migration --force + --name', async () => {
  //   ctx.fixture('schema-only-mysql')
  //   const result = MigrateDev.new('prisma').parse([
  //     '--name=first',
  //     '--force',
  //   ])

  //   await expect(result).resolves.toMatchInlineSnapshot(
  //     `Everything is now in sync.`,
  //   )
  //   expect(ctx.normalizedCapturedStdout())
  //     .toMatchInlineSnapshot(`
  //     Prisma schema loaded from prisma/schema.prisma
  //     The following migration(s) have been created and applied from new schema changes:

  //     prisma/migrations/
  //       └─ 20201231000000_first/
  //         └─ migration.sql

  //   `)
  // })

  it('draft migration and apply (--name)', async () => {
    ctx.fixture('schema-only-mysql')
    jest.setTimeout(7_000)

    const draftResult = MigrateDev.new('prisma').parse(
      ['--create-only', '--name=first'],
      await ctx.config(),
      ctx.configDir(),
    )

    await expect(draftResult).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000_first

      You can now edit it and apply it by running prisma migrate dev."
    `)

    const applyResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(applyResult).resolves.toMatchInlineSnapshot(`""`)

    expect((fs.list('prisma/migrations')?.length || 0) > 0).toMatchInlineSnapshot(`true`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MySQL database "tests-migrate-dev" <location placeholder>

      Datasource "my_db": MySQL database "tests-migrate-dev" <location placeholder>


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('existingdb: create first migration', async () => {
    ctx.fixture('schema-only-mysql')
    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MySQL database "tests-migrate-dev" <location placeholder>


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })
})

describeMatrix(sqlServerOnly, 'SQL Server', () => {
  if (process.env.CI) {
    // to avoid timeouts on macOS
    jest.setTimeout(80_000)
  } else {
    jest.setTimeout(20_000)
  }

  const databaseName = 'tests-migrate-dev'
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

    const url = process.env.TEST_MSSQL_JDBC_URI_MIGRATE!.replace('tests-migrate', databaseName)
    const shadowDatabaseUrl = process.env.TEST_MSSQL_SHADOWDB_JDBC_URI_MIGRATE?.replace(
      'tests-migrate-shadowdb',
      `${databaseName}-shadowdb`,
    )
    ctx.setDatasource({ url, shadowDatabaseUrl })
  })

  afterEach(async () => {
    await tearDownMSSQL(setupParams, databaseName).catch((e) => {
      console.error(e)
    })
  })

  it('schema only', async () => {
    ctx.fixture('schema-only-sqlserver')

    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQL Server database


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('schema only with shadowdb', async () => {
    ctx.fixture('schema-only-sqlserver')

    ctx.setConfigFile('shadowdb.config.ts')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQL Server database


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('create first migration', async () => {
    ctx.fixture('schema-only-sqlserver')
    const result = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQL Server database


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  // it('create first migration with nativeTypes', async () => {
  //   ctx.fixture('nativeTypes-sqlserver')

  //   const result = MigrateDev.new('prisma').parse(['--name=first'])
  //   await expect(result).resolves.toMatchInlineSnapshot(``)

  //   expect(ctx.normalizedCapturedStdout())
  //     .toMatchInlineSnapshot(`
  //     Prisma schema loaded from prisma/schema.prisma
  //     Datasource "db": PostgreSQL database "tests-migrate", schema "public" at "localhost:5432"

  //     The following migration(s) have been created and applied from new schema changes:

  //     prisma/migrations/
  //       └─ 20201231000000_first/
  //         └─ migration.sql

  //     Your database is now in sync with your schema.
  //   `)
  // })

  // it('first migration --force + --name', async () => {
  //   ctx.fixture('schema-only-sqlserver')
  //   const result = MigrateDev.new('prisma').parse([
  //     '--name=first',
  //     '--force',
  //   ])

  //   await expect(result).resolves.toMatchInlineSnapshot(
  //     `Everything is now in sync.`,
  //   )
  //   expect(ctx.normalizedCapturedStdout())
  //     .toMatchInlineSnapshot(`
  //     Prisma schema loaded from prisma/schema.prisma
  //     The following migration(s) have been created and applied from new schema changes:

  //     prisma/migrations/
  //       └─ 20201231000000_first/
  //         └─ migration.sql

  //   `)
  // })

  it('draft migration and apply (--name)', async () => {
    ctx.fixture('schema-only-sqlserver')

    const draftResult = MigrateDev.new('prisma').parse(
      ['--create-only', '--name=first'],
      await ctx.config(),
      ctx.configDir(),
    )

    await expect(draftResult).resolves.toMatchInlineSnapshot(`
      "Prisma Migrate created the following migration without applying it 20201231000000_first

      You can now edit it and apply it by running prisma migrate dev."
    `)

    const applyResult = MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(applyResult).resolves.toMatchInlineSnapshot(`""`)

    expect((fs.list('prisma/migrations')?.length || 0) > 0).toMatchInlineSnapshot(`true`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQL Server database

      Datasource "my_db": SQL Server database


      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })

  it('existingdb: create first migration', async () => {
    ctx.fixture('schema-only-sqlserver')
    const result = MigrateDev.new('prisma').parse(['--name=first'], await ctx.config(), ctx.configDir())

    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQL Server database


      The following migration(s) have been created and applied from new schema changes:

      prisma/migrations/
        └─ 20201231000000_first/
          └─ migration.sql

      Your database is now in sync with your schema.
      "
    `)
  })
})
