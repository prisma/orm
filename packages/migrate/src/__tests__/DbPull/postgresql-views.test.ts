import { loadSchemaContext, pathToPosix, toSchemasContainer } from '@prisma/internals'
import path from 'path'

import { DbPull } from '../../commands/DbPull'
import { Migrate } from '../../Migrate'
import { runQueryPostgres, SetupParams, setupPostgres, tearDownPostgres } from '../../utils/setupPostgres'
import { describeMatrix, postgresOnly } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

if (process.env.CI) {
  jest.setTimeout(300_000)
} else {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix(postgresOnly, 'postgresql-views', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace(
    'tests-migrate',
    'tests-migrate-db-pull-postgresql-views',
  )

  type ViewVariant =
    | 'no-views' // No views in the database
    | 'no-preview' // No "view" in `previewFeatures`

  const variantToPath = (variant?: ViewVariant) => {
    const basePath = 'views-fs' as const
    return variant === undefined ? basePath : (`${basePath}-${variant}` as const)
  }

  const computeSetupParams = (variant?: ViewVariant) => {
    const fixturePath = path.join('introspection', 'postgresql', variantToPath(variant))

    const setupParams: SetupParams = {
      connectionString,
      // Note: dirname points to a location with a setup.sql file
      // which will be executed to prepare the database with the correct tables, views etc.
      dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', fixturePath),
    }

    return { setupParams, fixturePath }
  }

  const setupPostgresForViewsIO = (variant?: ViewVariant) => {
    const { setupParams, fixturePath } = computeSetupParams(variant)

    beforeEach(async () => {
      await setupPostgres(setupParams)
      ctx.setDatasource({ url: connectionString })
    })

    afterEach(async () => {
      await tearDownPostgres(setupParams).catch((e) => {
        console.error(e)
      })
    })

    return { setupParams, fixturePath }
  }

  describe('engine output', () => {
    describe('no preview feature', () => {
      const { fixturePath } = setupPostgresForViewsIO('no-preview')

      it('`views` is null', async () => {
        ctx.fixture(path.join(fixturePath))

        const schemaContext = await loadSchemaContext()

        const { engine } = await Migrate.setup({
          schemaContext,
          schemaEngineConfig: await ctx.config(),
          baseDir: ctx.configDir(),
        })

        const introspectionResult = await engine.introspect({
          schema: toSchemasContainer(schemaContext.schemaFiles),
          viewsDirectoryPath: path.join(process.cwd(), 'prisma', 'views'),
          baseDirectoryPath: ctx.tmpDir,
          force: false,
        })

        expect(introspectionResult.views).toEqual(null)
        await engine.stop()
      })
    })

    describe('with preview feature and no views defined', () => {
      const { fixturePath } = setupPostgresForViewsIO('no-views')

      it('`views` is [] and no views folder is created', async () => {
        ctx.fixture(path.join(fixturePath))

        const schemaContext = await loadSchemaContext()
        const { engine } = await Migrate.setup({
          schemaContext,
          schemaEngineConfig: await ctx.config(),
          baseDir: ctx.configDir(),
        })

        const introspectionResult = await engine.introspect({
          schema: toSchemasContainer(schemaContext.schemaFiles),
          viewsDirectoryPath: path.join(process.cwd(), 'prisma', 'views'),
          baseDirectoryPath: ctx.tmpDir,
          force: false,
        })

        expect(introspectionResult.views).toEqual([])
        await engine.stop()

        const listWithoutViews = await ctx.fs.listAsync('views')
        expect(listWithoutViews).toEqual(undefined)
      })

      it('`views` is [] and an empty existing views folder is deleted', async () => {
        ctx.fixture(path.join(fixturePath))

        // Empty dir should be deleted along the views dir
        await ctx.fs.dirAsync('views/empty-dir')

        expect(await ctx.fs.listAsync()).toEqual([
          'node_modules',
          'prisma.config.ts',
          'schema.prisma',
          'setup.sql',
          'views',
        ])
        expect(await ctx.fs.listAsync('views')).toEqual(['empty-dir'])

        const schemaContext = await loadSchemaContext()
        const { engine } = await Migrate.setup({
          schemaContext,
          schemaEngineConfig: await ctx.config(),
          baseDir: ctx.configDir(),
        })

        const introspectionResult = await engine.introspect({
          schema: toSchemasContainer(schemaContext.schemaFiles),
          viewsDirectoryPath: path.join(process.cwd(), 'views'),
          baseDirectoryPath: ctx.tmpDir,
          force: false,
        })

        expect(introspectionResult.views).toEqual([])
        await engine.stop()

        const listWithoutViews = await ctx.fs.listAsync('views')
        expect(listWithoutViews).toEqual(undefined)
        // The views folder is deleted
        expect(await ctx.fs.listAsync()).toEqual(['node_modules', 'prisma.config.ts', 'schema.prisma', 'setup.sql'])
      })

      it('`views` is [] and a non-empty existing views folder is kept', async () => {
        ctx.fixture(path.join(fixturePath))

        ctx.fs.write('views/README.md', 'Some readme markdown')
        expect(await ctx.fs.listAsync()).toEqual([
          'node_modules',
          'prisma.config.ts',
          'schema.prisma',
          'setup.sql',
          'views',
        ])
        expect(await ctx.fs.listAsync('views')).toEqual(['README.md'])

        const schemaContext = await loadSchemaContext()
        const { engine } = await Migrate.setup({
          schemaContext,
          schemaEngineConfig: await ctx.config(),
          baseDir: ctx.configDir(),
        })

        const introspectionResult = await engine.introspect({
          schema: toSchemasContainer(schemaContext.schemaFiles),
          viewsDirectoryPath: path.join(process.cwd(), 'prisma', 'views'),
          baseDirectoryPath: ctx.tmpDir,
          force: false,
        })

        expect(introspectionResult.views).toEqual([])
        await engine.stop()

        const listWithoutViews = await ctx.fs.listAsync('views')
        expect(listWithoutViews).toEqual(['README.md'])
        expect(await ctx.fs.listAsync()).toEqual([
          'node_modules',
          'prisma.config.ts',
          'schema.prisma',
          'setup.sql',
          'views',
        ])
      })
    })
  })

  describe('with preview feature, views defined and then removed', () => {
    const { setupParams, fixturePath } = setupPostgresForViewsIO()

    // TODO: this test is too large in scope, it takes ~6s to run
    test('re-introspection with views removed', async () => {
      ctx.fixture(fixturePath)

      const introspectWithViews = DbPull.new('prisma')
      const resultWithViews = introspectWithViews.parse([], await ctx.config(), ctx.configDir())
      await expect(resultWithViews).resolves.toMatchInlineSnapshot(`""`)

      const listWithViews = await ctx.fs.listAsync('views')
      expect(listWithViews).toMatchInlineSnapshot(`
        [
          "public",
          "work",
        ]
      `)

      const treeWithViews = await ctx.fs.findAsync({
        directories: false,
        files: true,
        recursive: true,
        matching: 'views/**/*',
      })
      expect(treeWithViews).toMatchInlineSnapshot(`
        [
          "views/public/simpleuser.sql",
          "views/work/workers.sql",
        ]
      `)

      const dropViewsSQL = await ctx.fs.readAsync('./drop_views.sql', 'utf8')

      // remove any view in the database
      await runQueryPostgres(setupParams, dropViewsSQL!)

      const introspectWithoutViews = DbPull.new('prisma')
      const resultWithoutViews = introspectWithoutViews.parse([], await ctx.config(), ctx.configDir())
      await expect(resultWithoutViews).resolves.toMatchInlineSnapshot(`""`)

      const listWithoutViews = await ctx.fs.listAsync('views')
      expect(listWithoutViews).toEqual(undefined)

      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "Datasource "db": PostgreSQL database "tests-migrate-db-pull-postgresql-views", schemas "public, work" <location placeholder>

        - Introspecting based on datasource defined in schema.prisma
        ✔ Introspected 2 models and wrote them into schema.prisma in XXXms
              
        Run prisma generate to generate Prisma Client.
        Datasource "db": PostgreSQL database "tests-migrate-db-pull-postgresql-views", schemas "public, work" <location placeholder>

        - Introspecting based on datasource defined in schema.prisma
        ✔ Introspected 2 models and wrote them into schema.prisma in XXXms
              
        Run prisma generate to generate Prisma Client.
        "
      `)
    })
  })

  describe('with preview feature and views defined', () => {
    const { fixturePath } = setupPostgresForViewsIO()

    // TODO: this test is too large in scope, it takes ~5.2s to run
    test('basic introspection', async () => {
      ctx.fixture(fixturePath)

      const introspect = DbPull.new('prisma')
      const result = introspect.parse([], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`""`)

      const list = await ctx.fs.listAsync('views')
      expect(list).toMatchInlineSnapshot(`
        [
          "public",
          "work",
        ]
      `)

      const tree = await ctx.fs.findAsync({ directories: false, files: true, recursive: true, matching: 'views/**/*' })
      expect(tree).toMatchInlineSnapshot(`
        [
          "views/public/simpleuser.sql",
          "views/work/workers.sql",
        ]
      `)

      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "Datasource "db": PostgreSQL database "tests-migrate-db-pull-postgresql-views", schemas "public, work" <location placeholder>

        - Introspecting based on datasource defined in schema.prisma
        ✔ Introspected 2 models and wrote them into schema.prisma in XXXms
              
        Run prisma generate to generate Prisma Client.
        "
      `)
    })

    const schemaPaths = [
      {
        schemaPath: 'prisma/schema.prisma',
        viewsPath: 'prisma/views',
        needsMove: true,
        needsPathsArg: false,
      },
      {
        schemaPath: 'custom/schema/dir/schema.prisma',
        viewsPath: 'custom/schema/dir/views',
        needsMove: true,
        needsPathsArg: true,
      },
      {
        schemaPath: 'non-standard-schema.prisma',
        viewsPath: 'views',
        needsMove: true,
        needsPathsArg: true,
      },
      {
        schemaPath: 'schema.prisma',
        viewsPath: 'views',
        needsMove: false,
        needsPathsArg: false,
      },
    ] as const

    for (const { schemaPath, viewsPath, needsMove, needsPathsArg } of schemaPaths) {
      test(`introspection from ${schemaPath} creates view definition files`, async () => {
        ctx.fixture(fixturePath)

        if (needsMove) {
          await ctx.fs.moveAsync('schema.prisma', schemaPath)
        }

        const introspect = DbPull.new('prisma')
        const args = needsPathsArg ? ['--schema', `${schemaPath}`] : []
        const result = introspect.parse(args, await ctx.config(), ctx.configDir())
        await expect(result).resolves.toMatchInlineSnapshot(`""`)

        // the folders in `views` match the database schema names (public, work) of the views
        // defined in the `setup.sql` file
        const list = await ctx.fs.listAsync(viewsPath)
        expect(list).toMatchInlineSnapshot(`
          [
            "public",
            "work",
          ]
        `)

        const tree = await ctx.fs.findAsync({
          directories: false,
          files: true,
          recursive: true,
          matching: `${viewsPath}/**/*`,
        })
        const polishedTree = tree.map(pathToPosix)
        expect(polishedTree).toEqual([`${viewsPath}/public/simpleuser.sql`, `${viewsPath}/work/workers.sql`])

        const publicSimpleUserView = await ctx.fs.readAsync(`${viewsPath}/public/simpleuser.sql`)
        expect(publicSimpleUserView).toMatch(/SELECT\s*(su\.)?first_name,\s*(su\.)?last_name\s*FROM\s*someuser su;/)

        const workWorkersView = await ctx.fs.readAsync(`${viewsPath}/work/workers.sql`)
        expect(workWorkersView).toMatchInlineSnapshot(`
          "SELECT
            su.first_name,
            su.last_name,
            c.name AS company_name
          FROM
            (
              someuser su
              LEFT JOIN WORK.company c ON ((su.company_id = c.id))
            );"
        `)

        expect(ctx.normalizedCapturedStdout().replaceAll(schemaPath, '<schema-location>')).toMatchInlineSnapshot(`
          "Datasource "db": PostgreSQL database "tests-migrate-db-pull-postgresql-views", schemas "public, work" <location placeholder>

          - Introspecting based on datasource defined in <schema-location>
          ✔ Introspected 2 models and wrote them into <schema-location> in XXXms
                
          Run prisma generate to generate Prisma Client.
          "
        `)
        expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      })
    }

    // TODO: this test is too large in scope, it takes ~5.6s to run.
    // Also: is it really useful to delete the extraneous files/folders?
    test('extraneous empty subdirectories should be deleted and top files kept in views directory on introspect', async () => {
      ctx.fixture(path.join(fixturePath))

      await ctx.fs.dirAsync('views')
      const initialList = await ctx.fs.listAsync('views')
      expect(initialList).toMatchInlineSnapshot(`[]`)

      // Empty dir should be deleted
      await ctx.fs.dirAsync('views/empty-dir')
      // Any file on the top level should be kept
      await ctx.fs.fileAsync('views/README')
      await ctx.fs.fileAsync('views/extraneous-file.sql')
      const extraneousList = await ctx.fs.listAsync('views')
      extraneousList?.sort((a, b) => a.localeCompare(b, 'en-US'))
      expect(extraneousList).toMatchInlineSnapshot(`
        [
          "empty-dir",
          "extraneous-file.sql",
          "README",
        ]
      `)

      const introspect = DbPull.new('prisma')
      const result = introspect.parse([], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`""`)

      // the folders in `views` match the database schema names (public, work) of the views
      // defined in the `setup.sql` file
      const list = await ctx.fs.listAsync('views')
      list?.sort((a, b) => a.localeCompare(b, 'en-US'))
      expect(list).toMatchInlineSnapshot(`
        [
          "extraneous-file.sql",
          "public",
          "README",
          "work",
        ]
      `)

      const tree = await ctx.fs.findAsync({ directories: false, files: true, recursive: true, matching: 'views/**/*' })
      tree?.sort((a, b) => a.localeCompare(b, 'en-US'))
      expect(tree).toMatchInlineSnapshot(`
        [
          "views/extraneous-file.sql",
          "views/public/simpleuser.sql",
          "views/README",
          "views/work/workers.sql",
        ]
      `)
    })
  })

  describe('no preview', () => {
    const { fixturePath } = setupPostgresForViewsIO('no-preview')

    test('basic introspection', async () => {
      ctx.fixture(path.join(fixturePath))

      const introspect = DbPull.new('prisma')
      const result = introspect.parse([], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`""`)

      const list = await ctx.fs.listAsync('views')
      expect(list).toMatchInlineSnapshot(`undefined`)

      const tree = await ctx.fs.findAsync({ directories: false, files: true, recursive: true, matching: 'views/**/*' })
      expect(tree).toMatchInlineSnapshot(`[]`)

      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "Datasource "db": PostgreSQL database "tests-migrate-db-pull-postgresql-views", schemas "public, work" <location placeholder>

        - Introspecting based on datasource defined in schema.prisma
        ✔ Introspected 2 models and wrote them into schema.prisma in XXXms
              
        Run prisma generate to generate Prisma Client.
        "
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    test('introspect with already existing files in "views"', async () => {
      ctx.fixture(path.join(fixturePath))

      await ctx.fs.dirAsync('views/extraneous-dir')
      await ctx.fs.fileAsync('views/extraneous-file.sql')
      const extraneousList = await ctx.fs.listAsync('views')
      expect(extraneousList).toMatchInlineSnapshot(`
        [
          "extraneous-dir",
          "extraneous-file.sql",
        ]
      `)

      const introspect = DbPull.new('prisma')
      const result = introspect.parse([], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`""`)

      const list = await ctx.fs.listAsync('views')
      expect(list).toMatchInlineSnapshot(`
        [
          "extraneous-dir",
          "extraneous-file.sql",
        ]
      `)

      const tree = await ctx.fs.findAsync({ directories: false, files: true, recursive: true, matching: 'views/**/*' })
      expect(tree).toMatchInlineSnapshot(`
        [
          "views/extraneous-file.sql",
        ]
      `)
    })
  })
})
