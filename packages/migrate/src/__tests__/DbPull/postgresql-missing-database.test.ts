import { DbPull } from '../../commands/DbPull'
import { describeMatrix, postgresOnly } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix(postgresOnly, 'postgresql - missing database', () => {
  const defaultConnectionString = process.env.TEST_POSTGRES_URI_MIGRATE!

  // replace database name, e.g., 'tests-migrate', with 'unknown-database'
  const connectionString = defaultConnectionString.split('/').slice(0, -1).join('/') + '/unknown-database'

  beforeEach(() => {
    ctx.setDatasource({
      url: connectionString,
    })
  })

  test('basic introspection', async () => {
    ctx.fixture('introspection/postgresql')

    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      P1003 The introspected database does not exist:

      prisma db pull could not create any models in your schema.prisma file and you will not be able to generate Prisma Client with the prisma generate command.

      To fix this, you have two options:

      - manually create a database.
      - make sure the database connection URL inside the datasource block in schema.prisma points to an existing database.

      Then you can run prisma db pull again.
      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
