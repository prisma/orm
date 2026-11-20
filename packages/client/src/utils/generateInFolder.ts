import fs from 'node:fs'
import path from 'node:path'

import { generateClient } from '@prisma/client-generator-js'
import Debug from '@prisma/debug'
import { type GetSchemaResult, getSchemaWithPath, mergeSchemas } from '@prisma/internals'
import { getConfig, getDMMF, getPackedPackage } from '@prisma/internals'
import copy from '@timsuchanek/copy'
import { performance } from 'perf_hooks'

const debug = Debug('prisma:generateInFolder')

export interface GenerateInFolderOptions {
  projectDir: string
  packageSource?: string
}

export async function generateInFolder({ projectDir, packageSource }: GenerateInFolderOptions): Promise<number> {
  const before = performance.now()
  if (!projectDir) {
    throw new Error(`Project dir missing. Usage: ts-node examples/generate.ts examples/accounts`)
  }
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Path ${projectDir} does not exist`)
  }

  let schemaPathResult: GetSchemaResult | null = null
  const schemaNotFoundError = new Error(`Could not find any schema.prisma in ${projectDir} or sub directories.`)

  try {
    schemaPathResult = await getSchemaWithPath({ schemaPath: { baseDir: projectDir }, cwd: projectDir })
  } catch (e) {
    debug('Error in getSchemaPath', e)
  }

  if (!schemaPathResult) {
    throw schemaNotFoundError
  }

  const { schemas, schemaPath } = schemaPathResult

  const config = await getConfig({ datamodel: schemas })

  const outputDir = path.join(projectDir, 'node_modules/@prisma/client')

  await fs.promises.rm(outputDir, { force: true, recursive: true })

  if (packageSource) {
    await copy({
      from: packageSource, // when using yarn pack and extracting it, it includes a folder called "package"
      to: outputDir,
      recursive: true,
      parallelJobs: 20,
      overwrite: true,
    })
  } else {
    await getPackedPackage('@prisma/client', outputDir)
  }

  // TODO: use engine.getDmmf()
  const dmmf = await getDMMF({ datamodel: schemas })

  const schema = mergeSchemas({ schemas })

  await generateClient({
    binaryPaths: {},
    datamodel: schema,
    dmmf,
    ...config,
    outputDir,
    schemaPath,
    testMode: true,
    copyRuntime: false,
    runtimeSourcePath: path.join(__dirname, '../../runtime'),
    generator: config.generators[0],
    clientVersion: 'local',
    engineVersion: 'local',
    activeProvider: config.datasources[0].activeProvider,
    compilerBuild: 'fast',
  })

  const time = performance.now() - before
  debug(`Done generating client in ${time}`)

  return time
}
