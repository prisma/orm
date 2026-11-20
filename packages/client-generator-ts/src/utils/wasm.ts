import fs from 'node:fs'
import path from 'node:path'

import { Debug } from '@prisma/debug'
import { ActiveConnectorType } from '@prisma/generator'
import { match } from 'ts-pattern'

import type { FileMap } from '../generateClient'
import type { ModuleFormat } from '../module-format'
import type { RuntimeTargetInternal } from '../runtime-targets'
import type { RuntimeName } from '../TSClient/TSClient'

export type BuildWasmModuleOptions = {
  runtimeName: RuntimeName
  runtimeBase: string
  target: RuntimeTargetInternal
  activeProvider: ActiveConnectorType
  moduleFormat: ModuleFormat
  compilerBuild: 'fast' | 'small'
}

const debug = Debug('prisma:client-generator-ts:wasm')

function usesEdgeWasmRuntime(runtimeName: RuntimeName) {
  return runtimeName === 'wasm-compiler-edge'
}

export function buildGetWasmModule({
  runtimeName,
  runtimeBase,
  activeProvider,
  moduleFormat,
  compilerBuild,
}: BuildWasmModuleOptions) {
  const extension = match(moduleFormat)
    .with('esm', () => 'mjs')
    .with('cjs', () => 'js')
    .exhaustive()

  const buildNonEdgeLoader = runtimeName === 'client'
  const buildEdgeLoader = !buildNonEdgeLoader
  const artifactName = `query_compiler_${compilerBuild}_bg`

  let wasmPathBase: string
  let wasmBindingsPath: string
  let wasmModulePath: string

  // When using import statements to load the Wasm modules, we put the related
  // files in the generated client directory since some bundlers act weird when
  // importing them from the `@prisma/client` package. We can then rely on the
  // bundler to copy the WebAssembly module to the output directory and modify
  // the paths as needed.
  //
  // Conversely, when import base64-encoded Wasm definitions in Node.js-like environments,
  // potential usage of bundlers (or even transpiling TS with tsc into a
  // different directory!) would break loading the modules if we copied
  // them to the generated client directory because they would not be where we
  // expect them to be anymore. Therefore, we don't copy anything when
  // generating code for the `client` runtime, and we always load from
  // `@prisma/client/runtime` when doing it manually with `fs.readFile`. The
  // issues that can arise when importing Wasm from node_modules with bundlers
  // don't apply in this case because we are not *importing* them, we're just
  // reading a file on disk.
  if (buildEdgeLoader) {
    wasmPathBase = `./${artifactName}`
    wasmBindingsPath = `${wasmPathBase}.js`
    wasmModulePath = `${wasmPathBase}.wasm`
  } else {
    wasmPathBase = `${runtimeBase}/${artifactName}.${activeProvider}`
    wasmBindingsPath = `${wasmPathBase}.mjs`
    wasmModulePath = `${wasmPathBase}.wasm`
  }

  if (buildNonEdgeLoader) {
    wasmBindingsPath = `${wasmPathBase}.${extension}`
    wasmModulePath = `${wasmPathBase}.wasm-base64.${extension}`
    return `
async function decodeBase64AsWasm(wasmBase64: string): Promise<WebAssembly.Module> {
  const { Buffer } = await import('node:buffer')
  const wasmArray = Buffer.from(wasmBase64, 'base64')
  return new WebAssembly.Module(wasmArray)
}

config.compilerWasm = {
  getRuntime: async () => await import(${JSON.stringify(wasmBindingsPath)}),

  getQueryCompilerWasmModule: async () => {
    const { wasm } = await import(${JSON.stringify(wasmModulePath)})
    return await decodeBase64AsWasm(wasm)
  },

  importName: ${JSON.stringify(`./${artifactName}.js`)}
}`
  }

  if (buildEdgeLoader) {
    return `config.compilerWasm = {
  getRuntime: async () => await import(${JSON.stringify(wasmBindingsPath)}),

  getQueryCompilerWasmModule: async () => {
    const { default: module } = await import(${JSON.stringify(`${wasmModulePath}?module`)})
    return module
  },

  importName: ${JSON.stringify(`./${artifactName}.js`)}
}`
  }

  return `config.compilerWasm = undefined`
}

export type BuildWasmFileMapOptions = {
  activeProvider: ActiveConnectorType
  runtimeName: RuntimeName
  compilerBuild: 'fast' | 'small'
}

function readSourceFile(sourceFile: string): Buffer {
  const bundledLocation = path.join(__dirname, sourceFile)
  const sourceLocation = path.join(__dirname, '..', '..', '..', 'cli', 'build', sourceFile)

  if (fs.existsSync(bundledLocation)) {
    debug('We are in the bundled Prisma CLI')
    // The artifact exists in __dirname, this means we are in the bundled Prisma CLI
    return fs.readFileSync(bundledLocation)
  } else if (fs.existsSync(sourceLocation)) {
    debug('We are in a dev/test environment')
    // The artifact exists in the source location, this means we are in the development environment or tests
    return fs.readFileSync(sourceLocation)
  } else {
    throw new Error(`Could not find ${sourceFile} in ${bundledLocation} or ${sourceLocation}`)
  }
}

export function buildWasmFileMap({ activeProvider, runtimeName, compilerBuild }: BuildWasmFileMapOptions): FileMap {
  const fileMap: FileMap = {}
  debug('buildWasmFileMap with', { runtimeName })

  if (!usesEdgeWasmRuntime(runtimeName)) {
    debug('Skipping component compiler for runtime', runtimeName)
    return fileMap
  }

  const artifactName = `query_compiler_${compilerBuild}_bg`
  const fileNameBase = `${artifactName}.${activeProvider}` as const

  const files = {
    [`${artifactName}.wasm`]: `${fileNameBase}.wasm`,
    [`${artifactName}.js`]: `${fileNameBase}.mjs`,
  }

  for (const [targetFile, sourceFile] of Object.entries(files)) {
    fileMap[targetFile] = readSourceFile(sourceFile)
  }

  return fileMap
}
