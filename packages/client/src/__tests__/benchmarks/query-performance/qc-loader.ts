import fs from 'node:fs'
import path from 'node:path'

import { QueryCompilerConstructor } from '@prisma/client-common'

import { wasmQueryCompilerLoader } from '../../../runtime/core/engines/client/WasmQueryCompilerLoader'

export function loadQueryCompiler(provider: string): Promise<QueryCompilerConstructor> {
  const runtimeBase = path.join(__dirname, '..', '..', '..', '..', 'runtime')
  return wasmQueryCompilerLoader.loadQueryCompiler({
    activeProvider: provider,
    clientVersion: '0.0.0',
    compilerWasm: {
      getRuntime: () => {
        let runtimePath: string
        if (process.env.LOCAL_QC_BUILD_DIRECTORY) {
          runtimePath = path.join(process.env.LOCAL_QC_BUILD_DIRECTORY, provider, 'query_compiler_fast_bg.js')
        } else {
          runtimePath = path.join(runtimeBase, `query_compiler_fast_bg.${provider}.js`)
        }
        return Promise.resolve(require(runtimePath))
      },
      getQueryCompilerWasmModule: async () => {
        let moduleBytes: BufferSource
        if (process.env.LOCAL_QC_BUILD_DIRECTORY) {
          const wasmPath = path.join(process.env.LOCAL_QC_BUILD_DIRECTORY, provider, 'query_compiler_fast_bg.wasm')
          moduleBytes = await fs.promises.readFile(wasmPath)
        } else {
          const queryCompilerWasmFilePath = path.join(runtimeBase, `query_compiler_fast_bg.${provider}.wasm-base64.js`)
          const wasmBase64: string = require(queryCompilerWasmFilePath).wasm
          moduleBytes = Buffer.from(wasmBase64, 'base64')
        }
        return new WebAssembly.Module(moduleBytes)
      },
      importName: `./query_compiler_fast_bg.js`,
    },
  })
}
