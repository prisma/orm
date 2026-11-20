import fs from 'fs'
import path from 'path'

import type { BuildOptions } from '../../../helpers/compile/build'
import { build } from '../../../helpers/compile/build'
import { fillPlugin, smallBuffer, smallDecimal } from '../../../helpers/compile/plugins/fill-plugin/fillPlugin'
import { nodeProtocolPlugin } from '../../../helpers/compile/plugins/nodeProtocolPlugin'
import { noSideEffectsPlugin } from '../../../helpers/compile/plugins/noSideEffectsPlugin'

const wasmQueryCompilerDir = path.dirname(require.resolve('@prisma/query-compiler-wasm/package.json'))
const fillPluginDir = path.join('..', '..', 'helpers', 'compile', 'plugins', 'fill-plugin')
const functionPolyfillPath = path.join(fillPluginDir, 'fillers', 'function.ts')
const runtimeDir = path.resolve(__dirname, '..', 'runtime')

const DRIVER_ADAPTER_SUPPORTED_PROVIDERS = ['postgresql', 'sqlite', 'mysql', 'sqlserver', 'cockroachdb'] as const
type DriverAdapterSupportedProvider = (typeof DRIVER_ADAPTER_SUPPORTED_PROVIDERS)[number]

const MODULE_FORMATS = ['esm', 'cjs'] as const
type ModuleFormat = (typeof MODULE_FORMATS)[number]

const QUERY_COMPILER_BUILD_TYPES = ['fast', 'small'] as const
type QueryCompilerBuildType = (typeof QUERY_COMPILER_BUILD_TYPES)[number]

function getOutExtension(format: ModuleFormat): Record<string, string> {
  return {
    esm: { '.js': '.mjs' },
    cjs: { '.js': '.js' },
  }[format]
}

const shouldMinify = !process.env.DEV && process.env.MINIFY !== 'false'

const NODE_ESM_BANNER = `\
import * as __banner_node_module from "node:module";
import * as __banner_node_path from "node:path";
import * as process from "node:process";
import * as __banner_node_url from "node:url";
const __filename = __banner_node_url.fileURLToPath(import.meta.url);
globalThis['__dirname'] = __banner_node_path.dirname(__filename);
const require = __banner_node_module.createRequire(import.meta.url);`

// we define the config for runtime
function nodeRuntimeBuildConfig(targetBuildType: typeof TARGET_BUILD_TYPE, format: ModuleFormat): BuildOptions {
  return {
    format,
    name: targetBuildType,
    entryPoints: ['src/runtime/index.ts'],
    outfile: `runtime/${targetBuildType}`,
    outExtension: getOutExtension(format),
    bundle: true,
    minify: shouldMinify,
    sourcemap: 'linked',
    emitTypes: ['library', 'client'].includes(targetBuildType),
    external: ['@prisma/client-runtime-utils'],
    define: {
      NODE_CLIENT: 'true',
      TARGET_BUILD_TYPE: JSON.stringify(targetBuildType),
      // that fixes an issue with lz-string umd builds
      'define.amd': 'false',
    },
    plugins: [noSideEffectsPlugin(/^(arg|lz-string)$/), nodeProtocolPlugin],
    banner: format === 'esm' ? { js: NODE_ESM_BANNER } : undefined,
  }
}

function wasmBindgenRuntimeConfig(
  provider: DriverAdapterSupportedProvider,
  format: ModuleFormat,
  buildType: QueryCompilerBuildType,
): BuildOptions {
  return {
    format,
    name: `query_compiler_${buildType}_bg.${provider}`,
    entryPoints: [`@prisma/query-compiler-wasm/${provider}/query_compiler_${buildType}_bg.js`],
    outfile: `runtime/query_compiler_${buildType}_bg.${provider}`,
    outExtension: getOutExtension(format),
    minify: shouldMinify,
    plugins: [
      fillPlugin({
        defaultFillers: false,
        fillerOverrides: {
          Function: {
            define: 'fn',
            globals: functionPolyfillPath,
          },
        },
      }),
    ],
  }
}

// we define the config for browser
function browserBuildConfigs(): BuildOptions[] {
  return MODULE_FORMATS.map((format) => ({
    format,
    name: 'browser',
    entryPoints: ['src/runtime/index-browser.ts'],
    outfile: 'runtime/index-browser',
    outExtension: getOutExtension(format),
    target: ['chrome58', 'firefox57', 'safari11', 'edge16'],
    bundle: true,
    minify: shouldMinify,
    sourcemap: 'linked',
    external: ['@prisma/client-runtime-utils'],
  }))
}

/**
 * Overrides meant for edge and wasm builds
 * If at some point they diverge feel free to split them
 */
const commonRuntimesOverrides = {
  // we remove eval and Function for vercel
  eval: { define: 'undefined' },
  Function: {
    define: 'fn',
    globals: functionPolyfillPath,
  },
}

const runtimesCommonBuildConfig = {
  target: 'ES2022',
  entryPoints: ['src/runtime/index.ts'],
  bundle: true,
  minify: shouldMinify,
  sourcemap: 'linked',
  emitTypes: false,
  define: {
    // that helps us to tree-shake unused things out
    NODE_CLIENT: 'false',
    'globalThis.DEBUG_COLORS': 'false',
    // that fixes an issue with lz-string umd builds
    'define.amd': 'false',
  },
  logLevel: 'error',
  legalComments: 'none',
  external: ['@prisma/client-runtime-utils'],
} satisfies BuildOptions

function wasmFileToBase64(wasmBuffer: Buffer, format: ModuleFormat = 'esm'): string {
  const base64 = wasmBuffer.toString('base64')
  const moduleExports = format === 'esm' ? 'export { wasm }' : 'module.exports = { wasm }'
  const encodedWasmContent = `const wasm = "${base64}";\n${moduleExports}\n`
  return encodedWasmContent
}

// we define the config for wasm
function wasmEdgeRuntimeBuildConfig(format: ModuleFormat, name: string): BuildOptions {
  return {
    ...runtimesCommonBuildConfig,
    format,
    target: 'ES2022',
    name,
    outfile: `runtime/${name}`,
    outExtension: getOutExtension(format),
    define: {
      ...runtimesCommonBuildConfig.define,
      TARGET_BUILD_TYPE: `"${name}"`,
    },
    plugins: [
      fillPlugin({
        // not yet enabled in edge build while driverAdapters is not GA
        fillerOverrides: { ...commonRuntimesOverrides, ...smallBuffer, ...smallDecimal },
      }),
      {
        name: 'wasm-base64-encoder',
        setup(build) {
          build.onEnd(() => {
            const extToModuleFormatMap = {
              esm: 'mjs',
              cjs: 'js',
            } satisfies Record<ModuleFormat, string>

            for (const provider of DRIVER_ADAPTER_SUPPORTED_PROVIDERS) {
              for (const buildType of QUERY_COMPILER_BUILD_TYPES) {
                const wasmFilePath = path.join(wasmQueryCompilerDir, provider, `query_compiler_${buildType}_bg.wasm`)
                try {
                  const wasmBuffer = fs.readFileSync(wasmFilePath)
                  for (const [moduleFormat, extension] of Object.entries(extToModuleFormatMap)) {
                    const base64FilePath = path.join(
                      runtimeDir,
                      `query_compiler_${buildType}_bg.${provider}.wasm-base64.${extension}`,
                    )
                    const base64Content = wasmFileToBase64(wasmBuffer, moduleFormat as ModuleFormat)
                    fs.writeFileSync(base64FilePath, base64Content)
                  }
                } catch (error) {
                  throw new Error(`Failed to create base64 encoded WASM file for ${provider}`, {
                    cause: error,
                  })
                }
              }
            }
          })
        },
      },
    ],
  }
}

// default-index.js file in scripts
const defaultIndexConfig: BuildOptions = {
  name: 'default-index',
  entryPoints: ['src/scripts/default-index.ts'],
  outfile: 'scripts/default-index',
  bundle: true,
  emitTypes: false,
}

function writeDtsRexport(fileName: string) {
  fs.writeFileSync(path.join(runtimeDir, fileName), 'export * from "./client"\n')
}

function* allNodeRuntimeBuildConfigs(): Generator<BuildOptions> {
  for (const format of MODULE_FORMATS) {
    yield nodeRuntimeBuildConfig('client', format)
  }
}

function* allWasmEdgeRuntimeConfigs(): Generator<BuildOptions> {
  for (const format of MODULE_FORMATS) {
    yield wasmEdgeRuntimeBuildConfig(format, `wasm-compiler-edge`)
  }
}

function* allWasmBindgenRuntimeConfigs(): Generator<BuildOptions> {
  for (const provider of DRIVER_ADAPTER_SUPPORTED_PROVIDERS) {
    for (const format of MODULE_FORMATS) {
      for (const buildType of QUERY_COMPILER_BUILD_TYPES) {
        yield wasmBindgenRuntimeConfig(provider, format, buildType)
      }
    }
  }
}

void build([
  ...allNodeRuntimeBuildConfigs(),
  ...browserBuildConfigs(),
  ...allWasmEdgeRuntimeConfigs(),
  ...allWasmBindgenRuntimeConfigs(),
  defaultIndexConfig,
]).then(() => {
  writeDtsRexport('wasm-compiler-edge.d.ts')
})
