import path from 'path'

import { DbPull } from '../../commands/DbPull'
import { SetupParams, setupPostgres, tearDownPostgres } from '../../utils/setupPostgres'
import { describeMatrix, postgresOnly } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix(postgresOnly, 'postgresql-multischema', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace(
    'tests-migrate',
    'tests-migrate-db-pull-multischema-postgresql',
  )

  const setupParams: SetupParams = {
    connectionString,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'introspection', 'postgresql-multischema'),
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
    ctx.setDatasource({ url: connectionString })
  })

  afterEach(async () => {
    await tearDownPostgres(setupParams).catch((e) => {
      console.error(e)
    })
  })

  test('without datasource property `schemas` it should error with P4001, empty database', async () => {
    ctx.fixture('introspection/postgresql-multischema')
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
    ctx.fixture('introspection/postgresql-multischema')
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
       2 |   provider = "postgres"
       3 |   schemas  = []
         | 

      Validation Error Count: 1
      [Context: getConfig]

      Prisma CLI Version : 0.0.0"
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('datasource property `schemas=["base", "transactional"]` should succeed', async () => {
    ctx.fixture('introspection/postgresql-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-2-values.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "postgres"
        schemas  = ["base", "transactional"]
      }

      model User {
        id    String @id
        email String
        Post  Post[]

        @@schema("base")
      }

      model base_some_table {
        id         String                     @id(map: "User_pkey2")
        email      String
        some_table transactional_some_table[]

        @@map("some_table")
        @@schema("base")
      }

      model Post {
        id       String @id
        title    String
        authorId String
        User     User   @relation(fields: [authorId], references: [id])

        @@schema("transactional")
      }

      model transactional_some_table {
        id         String          @id(map: "Post_pkey2")
        title      String
        authorId   String
        some_table base_some_table @relation(fields: [authorId], references: [id], map: "Post_authorId_fkey2")

        @@map("some_table")
        @@schema("transactional")
      }

      enum base_status {
        ON
        OFF

        @@map("status")
        @@schema("base")
      }

      enum transactional_status {
        ON
        OFF

        @@map("status")
        @@schema("transactional")
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "
      // *** WARNING ***
      // 
      // These items were renamed due to their names being duplicates in the Prisma schema:
      //   - Type: "enum", name: "base_status"
      //   - Type: "enum", name: "transactional_status"
      //   - Type: "model", name: "base_some_table"
      //   - Type: "model", name: "transactional_some_table"
      // "
    `)
  })

  test('datasource property `schemas=["base"]` should succeed', async () => {
    ctx.fixture('introspection/postgresql-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-1-value.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "postgres"
        schemas  = ["base"]
      }

      model User {
        id    String @id
        email String

        @@schema("base")
      }

      model some_table {
        id    String @id(map: "User_pkey2")
        email String

        @@schema("base")
      }

      enum status {
        ON
        OFF

        @@schema("base")
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('datasource property `schemas=["does-not-exist"]` should error with P4001, empty database', async () => {
    ctx.fixture('introspection/postgresql-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-1-non-existing-value.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).rejects.toThrow(`P4001`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('datasource property `schemas=["does-not-exist", "base"]` should succeed', async () => {
    ctx.fixture('introspection/postgresql-multischema')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-schemas-in-datasource-1-existing-1-non-existing-value.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "postgres"
        schemas  = ["base", "does-not-exist"]
      }

      model User {
        id    String @id
        email String

        @@schema("base")
      }

      model some_table {
        id    String @id(map: "User_pkey2")
        email String

        @@schema("base")
      }

      enum status {
        ON
        OFF

        @@schema("base")
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
