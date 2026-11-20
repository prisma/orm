import type * as esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'

import { build } from '../../../helpers/compile/build'
import { esmSplitCodeToCjs } from '../../../helpers/compile/plugins/esmSplitCodeToCjs'

const copySchemaEngineWasmPlugin: esbuild.Plugin = {
  name: 'cliLifecyclePlugin',
  setup(build) {
    build.onEnd(async () => {
      // the package's `exports` map exposes the JS bindings but not the .wasm file, so we resolve
      // the former and derive the latter
      const schemaEngineRuntimePath = require.resolve('@prisma/schema-engine-wasm/schema_engine_bg')
      const prismaSchemaEngineWasmFile = path.join(path.dirname(schemaEngineRuntimePath), 'schema_engine_bg.wasm')

      await fs.promises.mkdir(path.resolve('./build'), { recursive: true })
      await fs.promises.copyFile(prismaSchemaEngineWasmFile, path.resolve('./build/schema_engine_bg.wasm'))
    })
  },
}

void build([
  {
    name: 'default',
    bundle: true,
    emitTypes: true,
    splitting: true,
    format: 'esm',
    external: ['@prisma/schema-engine-wasm'],
    plugins: [copySchemaEngineWasmPlugin, esmSplitCodeToCjs],
  },
])
