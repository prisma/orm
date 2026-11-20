import { ensureDatabaseExists } from '../utils/ensureDatabaseExists'
import { describeMatrix, sqliteOnly } from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

describeMatrix(sqliteOnly, 'SQLite', () => {
  it('can create database - sqlite', async () => {
    ctx.fixture('schema-only-sqlite')
    const result = ensureDatabaseExists(ctx.fs.path('prisma'), 'sqlite', await ctx.configWithDatasource())
    await expect(result).resolves.toMatchInlineSnapshot(`"SQLite database dev.db created at file:dev.db"`)
  })

  it('can create database - sqlite - folder', async () => {
    ctx.fixture('schema-folder-sqlite')
    const result = ensureDatabaseExists(ctx.fs.path('prisma'), 'sqlite', await ctx.configWithDatasource())
    await expect(result).resolves.toMatchInlineSnapshot(`"SQLite database dev.db created at file:dev.db"`)
  })
})
//
// Would need logic to be reproducible for testing other databases
// createDatabase is already tested in the `@prisma/internals` tests
//
