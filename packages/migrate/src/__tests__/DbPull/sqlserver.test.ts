import path from 'path'

import { DbPull } from '../../commands/DbPull'
import { setupMSSQL, tearDownMSSQL } from '../../utils/setupMSSQL'
import { SetupParams } from '../../utils/setupPostgres'
import { describeMatrix, sqlServerOnly } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

// We want to remove unique IDs to have stable snapshots
// Example:
// `PK__User__3213E83E450CDF1F` will be changed to `PK__User__RANDOM_ID_SANITIZED`
function sanitizeSQLServerIdName(schema: string) {
  const schemaRows = schema.split('\n')
  const regexp = new RegExp(/map: "PK__(.*)__(.*)"/)
  const schemaRowsSanitized = schemaRows.map((row) => {
    const match = regexp.exec(row)
    if (match) {
      row = row.replace(match[2], 'RANDOM_ID_SANITIZED')
    }
    return row
  })
  return schemaRowsSanitized.join('\n')
}

describeMatrix(sqlServerOnly, 'SQL Server', () => {
  if (!process.env.TEST_SKIP_MSSQL && !process.env.TEST_MSSQL_URI) {
    throw new Error('You must set a value for process.env.TEST_MSSQL_URI. See TESTING.md')
  }
  if (!process.env.TEST_SKIP_MSSQL && !process.env.TEST_MSSQL_JDBC_URI_MIGRATE) {
    throw new Error('You must set a value for process.env.TEST_MSSQL_JDBC_URI_MIGRATE. See TESTING.md')
  }

  const databaseName = 'tests-migrate-db-pull-sqlserver'
  const setupParams: SetupParams = {
    connectionString: process.env.TEST_MSSQL_URI!,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'introspection', 'sqlserver'),
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

  test('basic introspection', async () => {
    ctx.fixture('introspection/sqlserver')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "datasource db {
        provider = "sqlserver"
      }

      model jobs {
        job_id      Int       @id(map: "PK__jobs__CustomNameToAvoidRandomNumber") @default(autoincrement())
        customer_id Int?
        description String?   @db.VarChar(200)
        created_at  DateTime?
      }

      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})

describeMatrix(sqlServerOnly, 'sqlserver-multischema', () => {
  if (process.env.CI) {
    // to avoid timeouts on macOS
    jest.setTimeout(80_000)
  } else {
    jest.setTimeout(20_000)
  }

  if (!process.env.TEST_SKIP_MSSQL && !process.env.TEST_MSSQL_URI) {
    throw new Error('You must set a value for process.env.TEST_MSSQL_URI. See TESTING.md')
  }
  if (!process.env.TEST_SKIP_MSSQL && !process.env.TEST_MSSQL_JDBC_URI_MIGRATE) {
    throw new Error('You must set a value for process.env.TEST_MSSQL_JDBC_URI_MIGRATE. See TESTING.md')
  }

  // Note that this needs to be exactly the same as the one in the setup.sql file
  const databaseName = 'tests-migrate-db-pull-sqlserver-multischema'
  const setupParams: SetupParams = {
    connectionString: process.env.TEST_MSSQL_URI!,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'introspection', 'sqlserver-multischema'),
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
    ctx.setDatasource({ url })
  })

  afterEach(async () => {
    await tearDownMSSQL(setupParams, databaseName).catch((e) => {
      console.error(e)
    })
  })

  test('without datasource property `schemas` it should error with P4001, empty database', async () => {
    ctx.fixture('introspection/sqlserver-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'without-schemas-in-datasource.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).rejects.toThrow(`P4001`)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('datasource property `schemas=[]` should error with P1012, array can not be empty', async () => {
    ctx.fixture('introspection/sqlserver-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-0-value.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).rejects.toMatchInlineSnapshot(`
      "Prisma schema validation - (get-config wasm)
      Error code: P1012
      error: If provided, the schemas array can not be empty.
        -->  with-schemas-in-datasource-0-value.prisma:3
         | 
       2 |   provider = "sqlserver"
       3 |   schemas  = []
         | 

      Validation Error Count: 1
      [Context: getConfig]

      Prisma CLI Version : 0.0.0"
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  // TODO unskip in a following PR
  // We need to find out why this test can fail and pass in CI...
  // It was blocking the release pipeline
  // Examples
  // https://github.com/prisma/prisma/actions/runs/4013789656/jobs/6893546711 (most recent)
  // https://buildkite.com/prisma/test-prisma-typescript/builds/18825#01855966-3d90-4362-b130-502021a1047b
  test.skip('datasource property `schemas=["base", "transactional"]` should succeed', async () => {
    ctx.fixture('introspection/sqlserver-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-2-values.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(``)
    expect(sanitizeSQLServerIdName(ctx.normalizedCapturedStdout())).toMatchInlineSnapshot('')

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`

                                // *** WARNING ***
                                //
                                // The following models were ignored as they do not have a valid unique identifier or id. This is currently not supported by Prisma Client:
                                //   - transactional_some_table
                                //
                                // These items were renamed due to their names being duplicates in the Prisma schema:
                                //   - type: model, name: base_some_table
                                //   - type: model, name: transactional_some_table
                                //
        `)
  })

  test('datasource property `schemas=["base"]` should succeed', async () => {
    ctx.fixture('introspection/sqlserver-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-1-value.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(sanitizeSQLServerIdName(ctx.normalizedCapturedStdout())).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "sqlserver"
        schemas  = ["base"]
      }

      model some_table {
        id    String @id(map: "PK__some_tab__RANDOM_ID_SANITIZED") @db.NVarChar(1)
        email String @db.NVarChar(1)

        @@schema("base")
      }

      model SomeUser {
        id    String @id(clustered: false, map: "PK__SomeUser__RANDOM_ID_SANITIZED") @db.NVarChar(1)
        email String @db.NVarChar(1)

        @@schema("base")
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('datasource property `schemas=["does-not-exist"]` should error with P4001, empty database', async () => {
    ctx.fixture('introspection/sqlserver-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-1-non-existing-value.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).rejects.toThrow(`P4001`)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('datasource property `schemas=["does-not-exist", "base"]` should succeed', async () => {
    ctx.fixture('introspection/sqlserver-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-1-existing-1-non-existing-value.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(sanitizeSQLServerIdName(ctx.normalizedCapturedStdout())).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "sqlserver"
        schemas  = ["base", "does-not-exist"]
      }

      model some_table {
        id    String @id(map: "PK__some_tab__RANDOM_ID_SANITIZED") @db.NVarChar(1)
        email String @db.NVarChar(1)

        @@schema("base")
      }

      model SomeUser {
        id    String @id(clustered: false, map: "PK__SomeUser__RANDOM_ID_SANITIZED") @db.NVarChar(1)
        email String @db.NVarChar(1)

        @@schema("base")
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('url with `?schema=does-not-exist` should error with P4001, empty database', async () => {
    ctx.fixture('introspection/sqlserver')
    ctx.setDatasource({
      url: `${(await ctx.datasource())?.url}schema=does-not-exist`,
    })

    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrow(`P4001`)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('url with `?schema=base` should succeed', async () => {
    ctx.fixture('introspection/sqlserver')
    ctx.setDatasource({
      url: `${(await ctx.datasource())?.url}schema=base`,
    })

    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(sanitizeSQLServerIdName(ctx.normalizedCapturedStdout())).toMatchInlineSnapshot(`
      "datasource db {
        provider = "sqlserver"
      }

      model some_table {
        id    String @id(map: "PK__some_tab__RANDOM_ID_SANITIZED") @db.NVarChar(1)
        email String @db.NVarChar(1)
      }

      model SomeUser {
        id    String @id(clustered: false, map: "PK__SomeUser__RANDOM_ID_SANITIZED") @db.NVarChar(1)
        email String @db.NVarChar(1)
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
