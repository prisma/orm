import { handlePanic, inferDirectoryConfig, loadSchemaContext, toSchemasContainer } from '@prisma/internals'
import { Migrate } from '@prisma/migrate'
import path from 'path'

async function main() {
  const packageJsonVersion = '0.0.0'
  const enginesVersion = 'prismaEngineVersionHash'
  const command = 'something-test'

  try {
    const dirPath = path.join(__dirname, '..', '__tests__', 'fixtures', 'introspection', 'postgresql')

    process.chdir(dirPath)

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(dirPath, 'schema.prisma') },
    })
    const { viewsDirPath } = inferDirectoryConfig(schemaContext)

    const config = require(path.join(dirPath, 'prisma.config.ts'))

    const migrate = await Migrate.setup({ schemaContext, schemaEngineConfig: config, baseDir: dirPath })
    const engine = migrate.engine

    await engine.introspect({
      schema: toSchemasContainer(schemaContext.schemaFiles),
      viewsDirectoryPath: viewsDirPath,
      baseDirectoryPath: dirPath,
      force: false,
    })
    await engine.debugPanic()
  } catch (err) {
    console.debug({ err })

    const getDatabaseVersionSafe = () => Promise.resolve(undefined)
    handlePanic({
      error: err,
      cliVersion: packageJsonVersion,
      enginesVersion,
      command,
      getDatabaseVersionSafe,
    })
      .catch((e) => {
        console.error('Error: ' + e.stack)
        console.error('Error: ' + e.message)
      })
      .finally(() => {
        process.exit(1)
      })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
