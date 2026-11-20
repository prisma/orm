import type * as esbuild from 'esbuild'
import fs from 'fs'
import lineReplace from 'line-replace'
import path from 'path'

import type { BuildOptions } from '../../../helpers/compile/build'
import { build } from '../../../helpers/compile/build'
import { copyFilePlugin } from '../../../helpers/compile/plugins/copyFilePlugin'

/**
 * Manages the extra actions that are needed for the CLI to work
 */
const cliLifecyclePlugin: esbuild.Plugin = {
  name: 'cliLifecyclePlugin',
  setup(build) {
    build.onEnd(async () => {
      // we copy the contents from checkpoint-client to build
      await fs.promises.copyFile(
        path.join(path.dirname(require.resolve('checkpoint-client')), 'child.js'),
        './build/child.js',
      )

      // we copy the contents from xdg-open to build
      await fs.promises.copyFile(path.join(path.dirname(require.resolve('open')), 'xdg-open'), './build/xdg-open')

      // the schema Wasm packages are dependencies of @prisma/internals, so we resolve them from there
      const internalsPath = path.join(__dirname, '..', '..', 'internals')

      const prismaWasmFile = require.resolve('@prisma/prisma-schema-wasm/src/prisma_schema_build_bg.wasm', {
        paths: [internalsPath],
      })
      await fs.promises.copyFile(prismaWasmFile, './build/prisma_schema_build_bg.wasm')

      // the package's `exports` map exposes the JS bindings but not the .wasm file, so we resolve
      // the former and derive the latter
      const schemaEngineRuntimePath = require.resolve('@prisma/schema-engine-wasm/schema_engine_bg', {
        paths: [internalsPath],
      })
      const prismaSchemaEngineWasmFile = path.join(path.dirname(schemaEngineRuntimePath), 'schema_engine_bg.wasm')
      await fs.promises.copyFile(prismaSchemaEngineWasmFile, './build/schema_engine_bg.wasm')

      await copyClientWasmRuntime()

      await replaceFirstLine('./build/index.js', '#!/usr/bin/env node\n')

      chmodX('./build/index.js')
    })
  },
}

async function copyClientWasmRuntime() {
  const clientPath = path.join(__dirname, '..', '..', 'client')
  const clientRuntimePath = path.join(clientPath, 'runtime')

  for (const provider of ['cockroachdb', 'mysql', 'postgresql', 'sqlite', 'sqlserver']) {
    for (const build of ['fast', 'small']) {
      const baseName = `query_compiler_${build}_bg.${provider}`

      for (const file of [`${baseName}.js`, `${baseName}.mjs`]) {
        await fs.promises.copyFile(path.join(clientRuntimePath, file), `./build/${file}`)
      }

      // @prisma/query-compiler-wasm is a dependency of @prisma/client, so we resolve it from there
      const wasmFilePath = require.resolve(`@prisma/query-compiler-wasm/${provider}/query_compiler_${build}_bg.wasm`, {
        paths: [clientPath],
      })

      await fs.promises.copyFile(wasmFilePath, `./build/${baseName}.wasm`)
    }
  }
}

async function buildStudioFrontend() {
  const { build } = await import('esbuild')

  await build({
    bundle: true,
    entryPoints: ['src/studio-entry.ts'],
    format: 'esm',
    logLevel: 'error',
    minify: true,
    outfile: 'build/studio.js',
    platform: 'browser',
    target: 'ES2022',
    tsconfig: 'tsconfig.build.json',
  })

  await fs.promises.copyFile(require.resolve('@prisma/studio-core/ui/index.css'), './build/studio.css')
}

/**
 * Setup `import type { ... } from 'prisma'`.
 */
const cliTypesBuildConfig: BuildOptions = {
  name: 'cliTypes',
  entryPoints: ['src/types.ts'],
  outdir: 'dist',
  bundle: false,
  emitTypes: true,
  minify: false,
}

/**
 * Setup `import { ... } from 'prisma/config'`.
 */
const cliConfigBuildConfig: BuildOptions = {
  name: 'cliConfig',
  entryPoints: ['src/config.ts'],

  /**
   * We store `./config.js` and `./config.d.ts` in the root of the package to avoid TypeScript
   * errors for:
   * - users with default `"moduleResolution"` settings in their `tsconfig.json`
   * - users with old and inconsistent bundlers, like `webpack`
   */
  outdir: '.',
  plugins: [copyFilePlugin([{ from: 'dist/cli/src/config.d.ts', to: './config.d.ts' }])],

  bundle: false,
  emitTypes: true,
  minify: false,
}

const cliDispatcherBuildConfig: BuildOptions = {
  name: 'cli-dispatcher',
  entryPoints: ['src/bin-dispatcher.ts'],
  outfile: 'build/index',
  plugins: [cliLifecyclePlugin],
  bundle: true,
  external: ['./cli.js', './completion.js'],
  emitTypes: false,
  minify: true,
}

const cliBuildConfig: BuildOptions = {
  name: 'cli',
  entryPoints: ['src/cli-entry.ts'],
  outfile: 'build/cli',
  bundle: true,
  external: ['better-sqlite3', 'esbuild'],
  emitTypes: false,
  minify: true,
}

const cliCompletionBuildConfig: BuildOptions = {
  name: 'cli-completion',
  entryPoints: ['src/completions/completion-entry.ts'],
  outfile: 'build/completion',
  bundle: true,
  emitTypes: false,
  minify: true,
}

// Setup preinstall
const preinstallBuildConfig: BuildOptions = {
  name: 'preinstall',
  entryPoints: ['scripts/preinstall.ts'],
  outfile: 'preinstall/index',
  bundle: true,
  emitTypes: false,
  minify: true,
}

const optionalPlugins = process.env.DEV === 'true' ? [] : [cliTypesBuildConfig, cliConfigBuildConfig]

build([...optionalPlugins, cliDispatcherBuildConfig, cliBuildConfig, cliCompletionBuildConfig, preinstallBuildConfig])
  .then(buildStudioFrontend)
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

// Utils ::::::::::::::::::::::::::::::::::::::::::::::::::

function chmodX(filename: string) {
  const s = fs.statSync(filename)
  const newMode = s.mode | 64 | 8 | 1
  if (s.mode === newMode) return
  const base8 = newMode.toString(8).slice(-3)
  fs.chmodSync(filename, base8)
}

function replaceFirstLine(filename: string, line: string) {
  return new Promise((resolve) => {
    lineReplace({
      file: filename,
      line: 1,
      text: line,
      addNewLine: false,
      callback: resolve,
    })
  })
}
