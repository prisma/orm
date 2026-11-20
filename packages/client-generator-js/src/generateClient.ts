import type * as DMMF from '@prisma/dmmf'
import type {
  ActiveConnectorType,
  BinaryPaths,
  ConnectorType,
  DataSource,
  GeneratorConfig,
  SqlQueryOutput,
} from '@prisma/generator'
import { pathToPosix, setClassName } from '@prisma/internals'
import { createHash } from 'crypto'
import paths from 'env-paths'
import fs from 'fs/promises'
import { ensureDir } from 'fs-extra'
import { bold, dim, green, red } from 'kleur/colors'
import { packageUp } from 'package-up'
import path from 'path'
import type { O } from 'ts-toolbelt'

import clientPkg from '../../client/package.json'
import { getPrismaClientDMMF } from './getDMMF'
import { BrowserJS, JS, TS, TSClient } from './TSClient'
import { TSClientOptions } from './TSClient/TSClient'
import { buildTypedSql } from './typedSql/typedSql'
import { addPreamble, addPreambleToJSFiles } from './utils/addPreamble'

type OutputDeclaration = {
  content: string
  lineNumber: number
}

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
  runtimeBase?: string
  outputDir: string
  generator: GeneratorConfig
  dmmf: DMMF.Document
  datasources: DataSource[]
  binaryPaths: BinaryPaths
  testMode?: boolean
  copyRuntime?: boolean
  copyRuntimeSourceMaps?: boolean
  runtimeSourcePath: string
  engineVersion: string
  clientVersion: string
  activeProvider: ActiveConnectorType
  typedSql?: SqlQueryOutput[]
  compilerBuild: 'fast' | 'small'
}

export interface FileMap {
  [name: string]: string | FileMap
}

export interface BuildClientResult {
  fileMap: FileMap
  prismaClientDmmf: DMMF.Document
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function buildClient({
  schemaPath,
  runtimeBase,
  runtimeSourcePath,
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
  compilerBuild,
}: O.Required<GenerateClientOptions, 'runtimeBase'>): Promise<BuildClientResult> {
  const baseClientOptions: Omit<TSClientOptions, 'runtimeName'> = {
    dmmf: getPrismaClientDMMF(dmmf),
    datasources,
    generator,
    binaryPaths,
    schemaPath,
    outputDir,
    runtimeBase,
    runtimeSourcePath,
    clientVersion,
    engineVersion,
    activeProvider,
    datamodel,
    compilerBuild,
    browser: false,
    edge: false,
    wasm: false,
  }

  const nodeClientOptions = {
    ...baseClientOptions,
    runtimeName: 'client',
  }

  // we create a regular client that is fit for Node.js
  const nodeClient = new TSClient(nodeClientOptions)

  const defaultClient = new TSClient({
    ...nodeClientOptions,
    reusedTs: 'index',
    reusedJs: '.',
  })

  const trampolineTsClient = new TSClient({
    ...nodeClientOptions,
    reusedTs: 'index',
    reusedJs: '#main-entry-point',
  })

  // order of keys is important here. bundler/runtime will
  // match the first one they recognize, so it is important
  // to go from more specific to more generic.
  const exportsMapBase = {
    node: './index.js',
    'edge-light': './edge.js',
    workerd: './edge.js',
    worker: './edge.js',
    browser: './index-browser.js',
    default: './index.js',
  }

  const exportsMapDefault = {
    require: exportsMapBase,
    import: exportsMapBase,
    default: exportsMapBase.default,
  }

  const pkgJson = {
    name: getUniquePackageName(datamodel),
    main: 'index.js',
    types: 'index.d.ts',
    browser: 'index-browser.js',
    // The order of exports is important:
    // * `./client` before `...clientPkg.exports` allows it to have a higher priority than the `./*` export in `clientPkg.exports`
    // * `.` after `...clientPkg.exports` makes it override the `.` export in `clientPkgs.exports`
    exports: {
      './client': exportsMapDefault,
      ...clientPkg.exports,
      // TODO: remove on DA ga
      '.': exportsMapDefault,
    },
    version: clientVersion,
    sideEffects: false,
    dependencies: {
      '@prisma/client-runtime-utils': clientVersion,
    },
  }

  // we store the generated contents here
  const fileMap: FileMap = {}
  fileMap['index.js'] = JS(nodeClient)
  fileMap['index.d.ts'] = TS(nodeClient)
  fileMap['default.js'] = JS(defaultClient)
  fileMap['default.d.ts'] = TS(defaultClient)
  fileMap['index-browser.js'] = BrowserJS(nodeClient)
  fileMap['client.js'] = JS(defaultClient)
  fileMap['client.d.ts'] = TS(defaultClient)

  // The trampoline client points to #main-entry-point (see below).  We use
  // imports similar to an exports map to ensure correct imports.❗ Before
  // going GA, please notify @millsp as some things can be cleaned up:
  // - defaultClient can be deleted since trampolineTsClient will replace it.
  //   - Special handling of . paths in TSClient.ts can also be removed.
  // - The main @prisma/client exports map can be simplified:
  //   - Everything can point to `default.js`, including browser fields.
  //   - Exports map's `.` entry can be made like the others (e.g. `./edge`).
  // - exportsMapDefault can be deleted as it's only needed for defaultClient:
  //   - #main-entry-point can handle all the heavy lifting on its own.
  //   - Always using #main-entry-point is kept for GA (small breaking change).
  //   - exportsMapDefault can be inlined down below and MUST be removed elsewhere.
  // In short: A lot can be simplified, but can only happen in GA & P6.
  fileMap['default.js'] = JS(trampolineTsClient)
  fileMap['default.d.ts'] = TS(trampolineTsClient)

  const qcArtifactName = `query_compiler_${compilerBuild}_bg`
  fileMap['wasm-worker-loader.mjs'] = `export default import('./${qcArtifactName}.wasm')`
  fileMap['wasm-edge-light-loader.mjs'] = `export default import('./${qcArtifactName}.wasm?module')`

  pkgJson['browser'] = 'default.js' // also point to the trampoline client otherwise it is picked up by cfw
  pkgJson['imports'] = {
    // when `import('#wasm-compiler-loader')` is called, it will be resolved to the correct file
    '#wasm-compiler-loader': {
      // Keys reference: https://runtime-keys.proposal.wintercg.org/#keys

      /**
       * Vercel Edge Functions / Next.js Middlewares
       */
      'edge-light': './wasm-edge-light-loader.mjs',

      /**
       * Cloudflare Workers, Cloudflare Pages
       */
      workerd: './wasm-worker-loader.mjs',

      /**
       * (Old) Cloudflare Workers
       * @millsp It's a fallback, in case both other keys didn't work because we could be on a different edge platform. It's a hypothetical case rather than anything actually tested.
       */
      worker: './wasm-worker-loader.mjs',

      /**
       * Fallback for every other JavaScript runtime
       */
      default: './wasm-worker-loader.mjs',
    },
    // when `require('#main-entry-point')` is called, it will be resolved to the correct file
    '#main-entry-point': exportsMapDefault,
  }

  const wasmClient = new TSClient({
    ...baseClientOptions,
    runtimeName: 'wasm-compiler-edge',
    reusedTs: 'default',
    edge: true,
    wasm: true,
  })

  fileMap['edge.js'] = JS(wasmClient)
  fileMap['edge.d.ts'] = TS(wasmClient)

  if (typedSql && typedSql.length > 0) {
    const edgeRuntimeName = 'wasm-compiler-edge'
    const cjsEdgeIndex = `./sql/index.${edgeRuntimeName}.js`
    const esmEdgeIndex = `./sql/index.${edgeRuntimeName}.mjs`
    pkgJson.exports['./sql'] = {
      require: {
        types: './sql/index.d.ts',
        'edge-light': cjsEdgeIndex,
        workerd: cjsEdgeIndex,
        worker: cjsEdgeIndex,
        node: './sql/index.js',
        default: './sql/index.js',
      },
      import: {
        types: './sql/index.d.ts',
        'edge-light': esmEdgeIndex,
        workerd: esmEdgeIndex,
        worker: esmEdgeIndex,
        node: './sql/index.mjs',
        default: './sql/index.mjs',
      },
      default: './sql/index.js',
    } as any
    fileMap['sql'] = buildTypedSql({
      dmmf,
      runtimeBase: getTypedSqlRuntimeBase(runtimeBase),
      mainRuntimeName: 'client',
      queries: typedSql,
      edgeRuntimeName,
    })
  }
  fileMap['package.json'] = JSON.stringify(pkgJson, null, 2)

  addPreambleToJSFiles(fileMap)

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

function getDefaultOutdir(outputDir: string): string {
  if (outputDir.endsWith(path.normalize('node_modules/@prisma/client'))) {
    return path.join(outputDir, '../../.prisma/client')
  }

  return path.join(outputDir, '../../.prisma/client')
}

export async function generateClient(options: GenerateClientOptions): Promise<void> {
  const {
    datamodel,
    schemaPath,
    generator,
    dmmf,
    datasources,
    binaryPaths,
    testMode,
    copyRuntime,
    copyRuntimeSourceMaps = false,
    runtimeSourcePath,
    clientVersion,
    engineVersion,
    activeProvider,
    typedSql,
    compilerBuild,
  } = options

  const { runtimeBase, outputDir } = await getGenerationDirs(options)

  const { prismaClientDmmf, fileMap } = await buildClient({
    datamodel,
    schemaPath,
    runtimeBase,
    runtimeSourcePath,
    outputDir,
    generator,
    dmmf,
    datasources,
    binaryPaths,
    clientVersion,
    engineVersion,
    activeProvider,
    testMode,
    typedSql,
    compilerBuild,
  })

  const provider = datasources[0].provider

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

  await ensureDir(outputDir)

  await writeFileMap(outputDir, fileMap)

  // if users use a custom output dir
  if (copyRuntime || generator.isCustomOutput === true) {
    const copiedRuntimeDir = path.join(outputDir, 'runtime')
    await ensureDir(copiedRuntimeDir)

    await copyRuntimeFiles({
      from: runtimeSourcePath,
      to: copiedRuntimeDir,
      sourceMaps: copyRuntimeSourceMaps,
      runtimeName: 'client',
    })
  }

  const schemaTargetPath = path.join(outputDir, 'schema.prisma')
  await fs.writeFile(schemaTargetPath, datamodel, { encoding: 'utf-8' })

  // copy the necessary engine files needed for the wasm/driver-adapter engine
  if (isWasmEngineSupported(provider)) {
    const suffix = provider === 'postgres' ? 'postgresql' : provider
    const filename = `query_compiler_${compilerBuild}_bg`

    // Despite the `!testMode` condition above, we can't assume we are
    // necessarily inside the bundled Prisma CLI (`prisma generate` can also run
    // from a standalone or programmatic invocation). This means we can only rely
    // on what's shipped in the `@prisma/client` package here, and we have to
    // decode the WebAssembly binaries from base64.
    const wasmJsBundlePath = path.join(runtimeSourcePath, `${filename}.${suffix}.wasm-base64.js`)
    const wasmBase64: string = require(wasmJsBundlePath).wasm

    await fs.writeFile(path.join(outputDir, `${filename}.wasm`), Buffer.from(wasmBase64, 'base64'))
    await fs.copyFile(path.join(runtimeSourcePath, `${filename}.${suffix}.js`), path.join(outputDir, `${filename}.js`))
    await fs.copyFile(wasmJsBundlePath, path.join(outputDir, `${filename}.wasm-base64.js`))
  }

  try {
    // we tell our vscode extension to reload the types by modifying this file
    const prismaCache = paths('prisma').cache
    const signalsPath = path.join(prismaCache, 'last-generate')
    await fs.mkdir(prismaCache, { recursive: true })
    await fs.writeFile(signalsPath, Date.now().toString())
  } catch {}
}

function writeFileMap(outputDir: string, fileMap: FileMap) {
  return Promise.all(
    Object.entries(fileMap).map(async ([fileName, content]) => {
      const absolutePath = path.join(outputDir, fileName)
      // The deletion of the file is necessary, so VSCode
      // picks up the changes.
      await fs.rm(absolutePath, { recursive: true, force: true })
      if (typeof content === 'string') {
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

function isWasmEngineSupported(provider: ConnectorType) {
  return (
    provider === 'postgresql' ||
    provider === 'postgres' ||
    provider === 'cockroachdb' ||
    provider === 'mysql' ||
    provider === 'sqlite' ||
    provider === 'sqlserver'
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
 *
 * @returns
 */
async function getGenerationDirs({
  runtimeBase,
  generator,
  outputDir,
  datamodel,
  schemaPath,
  testMode,
}: GenerateClientOptions) {
  const isCustomOutput = generator.isCustomOutput === true
  const normalizedOutputDir = path.normalize(outputDir)
  let userRuntimeImport = isCustomOutput ? './runtime' : '@prisma/client/runtime'
  let userOutputDir = isCustomOutput ? normalizedOutputDir : getDefaultOutdir(normalizedOutputDir)

  if (testMode && runtimeBase) {
    userOutputDir = outputDir
    userRuntimeImport = pathToPosix(runtimeBase)
  }

  if (isCustomOutput) {
    await verifyOutputDirectory(userOutputDir, datamodel, schemaPath)
  }

  const userPackageRoot = await packageUp({ cwd: path.dirname(userOutputDir) })
  const userProjectRoot = userPackageRoot ? path.dirname(userPackageRoot) : process.cwd()

  return {
    runtimeBase: userRuntimeImport,
    outputDir: userOutputDir,
    projectRoot: userProjectRoot,
  }
}

async function verifyOutputDirectory(directory: string, datamodel: string, schemaPath: string) {
  let content: string
  try {
    content = await fs.readFile(path.join(directory, 'package.json'), 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      // no package.json exists, we are good
      return
    }
    throw e
  }
  const { name } = JSON.parse(content)
  if (name === clientPkg.name) {
    const message = [`Generating client into ${bold(directory)} is not allowed.`]
    message.push('This package is used by `prisma generate` and overwriting its content is dangerous.')
    message.push('')
    message.push('Suggestion:')
    const outputDeclaration = findOutputPathDeclaration(datamodel)

    if (outputDeclaration && outputDeclaration.content.includes(clientPkg.name)) {
      const outputLine = outputDeclaration.content
      message.push(`In ${bold(schemaPath)} replace:`)
      message.push('')
      message.push(`${dim(outputDeclaration.lineNumber)} ${replacePackageName(outputLine, red(clientPkg.name))}`)
      message.push('with')

      message.push(`${dim(outputDeclaration.lineNumber)} ${replacePackageName(outputLine, green('.prisma/client'))}`)
    } else {
      message.push(`Generate client into ${bold(replacePackageName(directory, green('.prisma/client')))} instead`)
    }

    message.push('')
    message.push("You won't need to change your imports.")
    message.push('Imports from `@prisma/client` will be automatically forwarded to `.prisma/client`')
    const error = new Error(message.join('\n'))
    throw error
  }
}

function replacePackageName(directoryPath: string, replacement: string): string {
  return directoryPath.replace(clientPkg.name, replacement)
}

function findOutputPathDeclaration(datamodel: string): OutputDeclaration | null {
  const lines = datamodel.split(/\r?\n/)

  for (const [i, line] of lines.entries()) {
    if (/output\s*=/.test(line)) {
      return { lineNumber: i + 1, content: line.trim() }
    }
  }
  return null
}

type CopyRuntimeOptions = {
  from: string
  to: string
  runtimeName: string
  sourceMaps: boolean
}

async function copyRuntimeFiles({ from, to, runtimeName, sourceMaps }: CopyRuntimeOptions) {
  const files = ['index-browser.js', 'index-browser.d.ts', 'wasm-compiler-edge.js']

  files.push(`${runtimeName}.js`)
  files.push(`${runtimeName}.d.ts`)

  if (sourceMaps) {
    files.push(...files.filter((file) => file.endsWith('.js')).map((file) => `${file}.map`))
  }

  await Promise.all(
    files.map(async (file) => {
      const sourcePath = path.join(from, file)
      const targetPath = path.join(to, file)

      if (file.endsWith('.js')) {
        const content = await fs.readFile(sourcePath, 'utf-8')
        await fs.writeFile(targetPath, addPreamble(content))
      } else {
        await fs.copyFile(sourcePath, targetPath)
      }
    }),
  )
}

/**
 * This function ensures that each generated client has unique package name
 * It appends sha256 of the schema to the fixed prefix. That ensures unique schemas
 * produce unique generated packages while still keeping `generate` results reproducible.
 *
 * Without unique package name, if you have several TS clients in the project, TS Compiler
 * might merge different `Prisma` namespace declarations together and produce unusable results.
 *
 * @param datamodel
 * @returns
 */
function getUniquePackageName(datamodel: string) {
  const hash = createHash('sha256')
  hash.write(datamodel)
  return `${GENERATED_PACKAGE_NAME_PREFIX}${hash.digest().toString('hex')}`
}

const GENERATED_PACKAGE_NAME_PREFIX = 'prisma-client-'
