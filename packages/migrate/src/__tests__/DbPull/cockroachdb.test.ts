import path from 'path'

import { DbPull } from '../../commands/DbPull'
import { setupCockroach, tearDownCockroach } from '../../utils/setupCockroach'
import { cockroachdbOnly, describeMatrix } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix(cockroachdbOnly, 'cockroachdb', () => {
  if (!process.env.TEST_SKIP_COCKROACHDB && !process.env.TEST_COCKROACH_URI_MIGRATE) {
    throw new Error('You must set a value for process.env.TEST_COCKROACH_URI_MIGRATE. See TESTING.md')
  }
  const connectionString = process.env.TEST_COCKROACH_URI_MIGRATE!.replace(
    'tests-migrate',
    'tests-migrate-db-pull-cockroachdb',
  )

  const setupParams = {
    connectionString: connectionString!,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'introspection', 'cockroachdb'),
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
    ctx.setDatasource({ url: connectionString })
  })

  afterEach(async () => {
    await tearDownCockroach(setupParams).catch((e) => {
      console.error(e)
    })
  })

  test('basic introspection (with cockroachdb provider)', async () => {
    ctx.fixture('introspection/cockroachdb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "cockroachdb"
      }

      model Post {
        id        String    @id
        createdAt DateTime  @default(now())
        updatedAt DateTime  @default(dbgenerated("'1970-01-01 00:00:00'::TIMESTAMP"))
        published Boolean   @default(false)
        title     String
        content   String?
        authorId  String?
        jsonData  Json?
        coinflips Boolean[]
        User      User?     @relation(fields: [authorId], references: [id])
      }

      model User {
        id    String  @id
        email String  @unique(map: "User.email")
        name  String?
        Post  Post[]
      }

      enum Role {
        USER
        ADMIN
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('basic introspection (with postgresql provider) should fail', async () => {
    ctx.fixture('introspection/cockroachdb')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'with-postgresql-provider.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "You are trying to connect to a CockroachDB database, but the provider in your Prisma schema is \`postgresql\`. Please change it to \`cockroachdb\`.

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
