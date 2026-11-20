import fs from 'fs-jetpack'

import { MigrateDeploy } from '../commands/MigrateDeploy'
import type { SetupParams } from '../utils/setupPostgres'
import { setupPostgres, tearDownPostgres } from '../utils/setupPostgres'
import { describeMatrix, postgresOnly, sqliteOnly } from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

describe('prisma.config.ts', () => {
  it('should require a datasource in the config', async () => {
    ctx.fixture('no-config')

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"The datasource.url property is required in your Prisma config file when using prisma migrate deploy."`,
    )
  })
})

describe('common', () => {
  it('should fail if no schema file', async () => {
    ctx.fixture('empty')
    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
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
})

describeMatrix(sqliteOnly, 'SQLite', () => {
  it('no unapplied migrations', async () => {
    ctx.fixture('schema-only-sqlite')
    ctx.setConfigFile('empty.config.ts')

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`"No pending migrations to apply."`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      No migration found in prisma/migrations


      "
    `)
    expect(ctx.mocked['console.log'].mock.calls).toMatchInlineSnapshot('[]')
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('should work with nested config and schema', async () => {
    ctx.fixture('prisma-config-nested-sqlite')
    ctx.setConfigFile('config/prisma.config.ts')

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`"No pending migrations to apply."`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      No migration found in prisma/migrations


      "
    `)
    expect(ctx.mocked['console.log'].mock.calls).toMatchInlineSnapshot('[]')
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('1 unapplied migration', async () => {
    ctx.fixture('existing-db-1-migration')
    fs.remove('dev.db')

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`
      "The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_init/
          └─ migration.sql

      All migrations have been successfully applied."
    `)

    // Second time should do nothing (already applied)
    const resultBis = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(resultBis).resolves.toMatchInlineSnapshot(`"No pending migrations to apply."`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations


      Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations


      "
    `)
    expect(ctx.mocked['console.log'].mock.calls).toMatchInlineSnapshot('[]')
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('1 unapplied migration (folder)', async () => {
    ctx.fixture('schema-folder-sqlite-migration-exists')
    fs.remove('dev.db')

    ctx.setConfigFile('folder.config.ts')

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`
      "The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_init/
          └─ migration.sql

      All migrations have been successfully applied."
    `)

    // Second time should do nothing (already applied)
    const resultBis = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(resultBis).resolves.toMatchInlineSnapshot(`"No pending migrations to apply."`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations


      Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations


      "
    `)
    expect(ctx.mocked['console.log'].mock.calls).toMatchInlineSnapshot('[]')
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('should throw if database is not empty', async () => {
    ctx.fixture('existing-db-1-migration-conflict')

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`
      "P3005

      The database schema is not empty. Read more about how to baseline an existing production database: https://pris.ly/d/migrate-baseline
      "
    `)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations

      "
    `)
    expect(ctx.mocked['console.log'].mock.calls).toMatchInlineSnapshot('[]')
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })
})

describeMatrix(postgresOnly, 'postgres', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace('tests-migrate', 'tests-migrate-deploy')

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

  it('should fail if url is prisma://', async () => {
    ctx.fixture('schema-only-data-proxy')
    ctx.setDatasource({
      url: 'prisma://aws-us-east-1.prisma-data.com/?api_key=MY_API_KEY',
    })

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      Using an Accelerate URL is not supported for this CLI command prisma migrate deploy yet.
      Please use a direct connection to your database in \`prisma7.config.ts\`.

      More information about this limitation: https://pris.ly/d/accelerate-limitations
      "
    `)
  })

  it('should work if direct URL is set via config', async () => {
    ctx.fixture('schema-only-data-proxy')
    ctx.setDatasource({
      url: connectionString,
    })

    const result = MigrateDeploy.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`"No pending migrations to apply."`)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from schema.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": PostgreSQL database "tests-migrate-deploy", schema "public" <location placeholder>

      No migration found in prisma/migrations


      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
