import fs from 'node:fs/promises'
import path from 'node:path'

import type * as DMMF from '@prisma/dmmf'
import type { ActiveConnectorType, BinaryPaths, DataSource, GeneratorConfig, SqlQueryOutput } from '@prisma/generator'
import { assertNever, pathToPosix, setClassName } from '@prisma/internals'
import { glob } from 'fast-glob'
import { ensureDir } from 'fs-extra'
import { bold, red } from 'kleur/colors'
import { packageUp } from 'package-up'
import type { O } from 'ts-toolbelt'

import {
  GeneratedFileExtension,
  generatedFileNameMapper,
  ImportFileExtension,
  importFileNameMapper,
} from './file-extensions'
import { getPrismaClientDMMF } from './getDMMF'
import { ModuleFormat } from './module-format'
import type { RuntimeTargetInternal } from './runtime-targets'
import { TSClient } from './TSClient'
import { RuntimeName, TSClientOptions } from './TSClient/TSClient'
import { buildTypedSql } from './typedSql/typedSql'
import { addPreambleToSourceFiles } from './utils/addPreamble'
import { buildWasmFileMap } from './utils/wasm'

export class DenylistError extends Error {
  constructor(message: string) {
    super(message)
    this.stack = undefined
  }
}

setClassName(DenylistError, 'DenylistError')

export interface GenerateClientOptions {
  datamodel: string
  schemaPath: string
  /** Runtime path used in runtime/type imports */
  runtimeBase: string
  outputDir: string
  generator: GeneratorConfig
  dmmf: DMMF.Document
  datasources: DataSource[]
  binaryPaths: BinaryPaths
  engineVersion: string
  clientVersion: string
  activeProvider: ActiveConnectorType
  typedSql?: SqlQueryOutput[]
  target: RuntimeTargetInternal
  generatedFileExtension: GeneratedFileExtension
  importFileExtension: ImportFileExtension
  moduleFormat: ModuleFormat
  /** Include a "@ts-nocheck" comment at the top of all generated TS files */
  tsNoCheckPreamble: Boolean
  compilerBuild: 'fast' | 'small'
}

export interface FileMap {
  [name: string]: string | Buffer | FileMap
}

export interface BuildClientResult {
  fileMap: FileMap
  prismaClientDmmf: DMMF.Document
}

export function buildClient({
  schemaPath,
  runtimeBase,
  datamodel,
  binaryPaths,
  outputDir,
  generator,
  dmmf,
  datasources,
  engineVersion,
  clientVersion,
  activeProvider,
  typedSql,
  target,
  generatedFileExtension,
  importFileExtension,
  moduleFormat,
  tsNoCheckPreamble,
  compilerBuild,
}: O.Required<GenerateClientOptions, 'runtimeBase'>): BuildClientResult {
  // we define the basic options for the client generation
  const runtimeName = getRuntimeNameForTarget(target)

  const outputName = generatedFileNameMapper(generatedFileExtension)
  const importName = importFileNameMapper(importFileExtension)

  const clientOptions: TSClientOptions = {
    dmmf: getPrismaClientDMMF(dmmf),
    datasources,
    generator,
    binaryPaths,
    schemaPath,
    outputDir,
    runtimeBase,
    clientVersion,
    engineVersion,
    activeProvider,
    datamodel,
    edge: (['wasm-compiler-edge'] as RuntimeName[]).includes(runtimeName),
    runtimeName: runtimeName,
    target,
    generatedFileExtension,
    importFileExtension,
    moduleFormat,
    tsNoCheckPreamble,
    compilerBuild,
  }

  const client = new TSClient(clientOptions)

  let fileMap = client.generateClientFiles()

  if (typedSql && typedSql.length > 0) {
    fileMap = {
      ...fileMap,
      ...buildTypedSql({
        dmmf,
        runtimeBase: getTypedSqlRuntimeBase(runtimeBase),
        runtimeName,
        queries: typedSql,
        outputName,
        importName,
      }),
    }
  }

  fileMap = {
    ...fileMap,
    internal: {
      ...(fileMap.internal as FileMap),
      ...buildWasmFileMap({
        runtimeName,
        activeProvider,
        compilerBuild,
      }),
    },
  }

  addPreambleToSourceFiles(fileMap, tsNoCheckPreamble)

  return {
    fileMap, // a map of file names to their contents
    prismaClientDmmf: dmmf, // the DMMF document
  }
}

// relativizes runtime import base for typed sql
// absolute path stays unmodified, relative goes up a level
function getTypedSqlRuntimeBase(runtimeBase: string) {
  if (!runtimeBase.startsWith('.')) {
    // absolute path
    return runtimeBase
  }

  if (runtimeBase.startsWith('./')) {
    // replace ./ with ../
    return `.${runtimeBase}`
  }

  return `../${runtimeBase}`
}

export async function generateClient(options: GenerateClientOptions): Promise<void> {
  const {
    datamodel,
    schemaPath,
    generator,
    dmmf,
    datasources,
    binaryPaths,
    clientVersion,
    engineVersion,
    activeProvider,
    typedSql,
    target,
    generatedFileExtension,
    importFileExtension,
    moduleFormat,
    tsNoCheckPreamble,
    compilerBuild,
  } = options

  const { runtimeBase, outputDir } = await getGenerationDirs(options)

  const { prismaClientDmmf, fileMap } = buildClient({
    datamodel,
    schemaPath,
    runtimeBase,
    outputDir,
    generator,
    dmmf,
    datasources,
    binaryPaths,
    clientVersion,
    engineVersion,
    activeProvider,
    typedSql,
    target,
    generatedFileExtension,
    importFileExtension,
    moduleFormat,
    tsNoCheckPreamble,
    compilerBuild,
  })

  const denylistsErrors = validateDmmfAgainstDenylists(prismaClientDmmf)

  if (denylistsErrors) {
    let message = `${bold(
      red('Error: '),
    )}The schema at "${schemaPath}" contains reserved keywords.\n       Rename the following items:`

    for (const error of denylistsErrors) {
      message += '\n         - ' + error.message
    }

    message += `\nTo learn more about how to rename models, check out https://pris.ly/d/naming-models`

    throw new DenylistError(message)
  }

  await deleteOutputDir(outputDir)
  await ensureDir(outputDir)

  await writeFileMap(outputDir, fileMap)
}

function writeFileMap(outputDir: string, fileMap: FileMap) {
  return Promise.all(
    Object.entries(fileMap).map(async ([fileName, content]) => {
      const absolutePath = path.join(outputDir, fileName)
      // The deletion of the file is necessary, so VSCode
      // picks up the changes.
      await fs.rm(absolutePath, { recursive: true, force: true })
      if (typeof content === 'string' || Buffer.isBuffer(content)) {
        // file
        await fs.writeFile(absolutePath, content)
      } else {
        // subdirectory
        await fs.mkdir(absolutePath)
        await writeFileMap(absolutePath, content)
      }
    }),
  )
}

function validateDmmfAgainstDenylists(prismaClientDmmf: DMMF.Document): Error[] | null {
  const errorArray = [] as Error[]

  const denylists = {
    // A copy of this list is also in prisma-engines. Any edit should be done in both places.
    // https://github.com/prisma/prisma-engines/blob/main/psl/parser-database/src/names/reserved_model_names.rs
    models: [
      // Reserved Prisma keywords
      'PrismaClient',
      'Prisma',
      // JavaScript keywords
      'async',
      'await',
      'break',
      'case',
      'catch',
      'class',
      'const',
      'continue',
      'debugger',
      'default',
      'delete',
      'do',
      'else',
      'enum',
      'export',
      'extends',
      'false',
      'finally',
      'for',
      'function',
      'if',
      'implements',
      'import',
      'in',
      'instanceof',
      'interface',
      'let',
      'new',
      'null',
      'package',
      'private',
      'protected',
      'public',
      'return',
      'super',
      'switch',
      'this',
      'throw',
      'true',
      'try',
      'using',
      'typeof',
      'var',
      'void',
      'while',
      'with',
      'yield',
    ],
    fields: ['AND', 'OR', 'NOT'],
    dynamic: [],
  }

  if (prismaClientDmmf.datamodel.enums) {
    for (const it of prismaClientDmmf.datamodel.enums) {
      if (denylists.models.includes(it.name) || denylists.fields.includes(it.name)) {
        errorArray.push(Error(`"enum ${it.name}"`))
      }
    }
  }

  if (prismaClientDmmf.datamodel.models) {
    for (const it of prismaClientDmmf.datamodel.models) {
      if (denylists.models.includes(it.name) || denylists.fields.includes(it.name)) {
        errorArray.push(Error(`"model ${it.name}"`))
      }
    }
  }

  return errorArray.length > 0 ? errorArray : null
}

/**
 * Get all the directories involved in the generation process.
 */
async function getGenerationDirs({ runtimeBase, outputDir }: GenerateClientOptions) {
  const normalizedOutputDir = path.normalize(outputDir)
  const normalizedRuntimeBase = pathToPosix(runtimeBase)

  const userPackageRoot = await packageUp({ cwd: path.dirname(normalizedOutputDir) })
  const userProjectRoot = userPackageRoot ? path.dirname(userPackageRoot) : process.cwd()

  return {
    runtimeBase: normalizedRuntimeBase,
    outputDir: normalizedOutputDir,
    projectRoot: userProjectRoot,
  }
}

function getRuntimeNameForTarget(target: RuntimeTargetInternal): RuntimeName {
  switch (target) {
    case 'nodejs':
    case 'deno':
      return 'client'

    case 'workerd':
    case 'vercel-edge':
      return 'wasm-compiler-edge'

    default:
      assertNever(target, 'Unknown runtime target')
  }
}

async function deleteOutputDir(outputDir: string) {
  try {
    const files = await fs.readdir(outputDir)

    if (files.length === 0) {
      return
    }

    if (
      !files.includes('client.ts') &&
      !files.includes('client.mts') &&
      !files.includes('client.cts') &&
      !files.includes('client.d.ts') // for legacy js client
    ) {
      // Make sure users don't accidentally wipe their source code or home directory.
      throw new Error(
        `${outputDir} exists and is not empty but doesn't look like a generated Prisma Client. ` +
          'Please check your output path and remove the existing directory if you indeed want to generate the Prisma Client in that location.',
      )
    }

    await Promise.allSettled(
      (
        await glob(
          [
            `${outputDir}/**/*.{js,ts,mts,cts,d.ts}`,
            `${outputDir}/**/*.wasm`,
            `${outputDir}/*.node`,
            `${outputDir}/{query,schema}-engine-*`,
            `${outputDir}/package.json`,
            `${outputDir}/**/*.prisma`,
          ],
          {
            followSymbolicLinks: false,
          },
        )
      ).map((file) => fs.unlink(file)),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}
