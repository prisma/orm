import { TSClientOptions } from '../TSClient/TSClient'

/**
 * Builds the necessary glue code to load the query compiler wasm module.
 * @returns
 */
export function buildQueryCompilerWasmModule(
  forceEdgeWasmLoader: boolean,
  runtimeName: TSClientOptions['runtimeName'],
  compilerBuild: TSClientOptions['compilerBuild'],
) {
  const artifactName = `query_compiler_${compilerBuild}_bg`
  if (runtimeName === 'client' && !forceEdgeWasmLoader) {
    return `config.compilerWasm = {
      getRuntime: async () => require('./${artifactName}.js'),
      getQueryCompilerWasmModule: async () => {
        const { Buffer } = require('node:buffer')
        const { wasm } = require('./${artifactName}.wasm-base64.js')
        const queryCompilerWasmFileBytes = Buffer.from(wasm, 'base64')

        return new WebAssembly.Module(queryCompilerWasmFileBytes)
      },
      importName: './${artifactName}.js',
    }`
  }

  // For cloudflare (workers) we need to use import in order to load wasm
  // so we use a dynamic import which is compatible with both cjs and esm.
  // Additionally, we need to append `?module` to the import path for vercel,
  // which is incompatible with cloudflare, so we hide it in a template.
  // In `getQueryCompilerWasmModule`, we use a `try/catch` block because `vitest`
  // isn't able to handle dynamic imports with `import(#MODULE_NAME)`, which used
  // to lead to a runtime "No such module .prisma/client/#wasm-compiler-loader" error.
  // Related issue: https://github.com/vitest-dev/vitest/issues/5486.
  if ((runtimeName === 'client' && forceEdgeWasmLoader) || runtimeName === 'wasm-compiler-edge') {
    return `config.compilerWasm = {
  getRuntime: async () => require('./${artifactName}.js'),
  getQueryCompilerWasmModule: async () => {
    const loader = (await import('#wasm-compiler-loader')).default
    const compiler = (await loader).default
    return compiler
  },
  importName: './${artifactName}.js',
}`
  }

  return `config.compilerWasm = undefined`
}
