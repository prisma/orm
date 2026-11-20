import { Extractor, ExtractorConfig } from '@microsoft/api-extractor'
import type * as esbuild from 'esbuild'
import fs from 'fs-extra'
import path from 'path'

import { run } from '../run'

/**
 * Bundle all type definitions by using the API Extractor from RushStack
 * @param filename the source d.ts to bundle
 * @param outfile the output bundled file
 */
function bundleTypeDefinitions(filename: string, outfile: string, externals: string[]) {
  const { dependencies, peerDependencies, devDependencies } = require(`${process.cwd()}/package.json`)

  // get the list of bundled and non bundled as well as their eventual type dependencies
  const dependenciesKeys = Object.keys(dependencies ?? {}).flatMap((p) => [p, getTypeDependencyPackageName(p)])
  const peerDependenciesKeys = Object.keys(peerDependencies ?? {}).flatMap((p) => [p, getTypeDependencyPackageName(p)])
  const devDependenciesKeys = Object.keys(devDependencies ?? {}).flatMap((p) => [p, getTypeDependencyPackageName(p)])

  const includeDeps = devDependenciesKeys
  const excludeDeps = [...dependenciesKeys, ...peerDependenciesKeys, ...externals]
  const bundledPackages = includeDeps.filter((dep) => !excludeDeps.includes(dep))

  // we give the config in its raw form instead of a file
  const extractorConfig = ExtractorConfig.prepare({
    configObject: {
      projectFolder: process.cwd(),
      mainEntryPointFilePath: filename,
      bundledPackages,
      compiler: {
        tsconfigFilePath: path.join(process.cwd(), 'tsconfig.build.json'),
        overrideTsconfig: {
          compilerOptions: {
            paths: {}, // bug with api extract + paths
          },
        },
      },
      dtsRollup: {
        enabled: true,
        untrimmedFilePath: path.join(process.cwd(), `${outfile}.d.ts`),
      },
      tsdocMetadata: {
        enabled: false,
      },
    },
    packageJsonFullPath: path.join(process.cwd(), 'package.json'),
    configObjectFullPath: undefined,
  })

  // here we trigger the "command line" interface equivalent
  const extractorResult = Extractor.invoke(extractorConfig, {
    showVerboseMessages: true,
    localBuild: true,
  })

  // we exit the process immediately if there were errors
  if (extractorResult.succeeded === false) {
    console.error(`API Extractor completed with errors`)
    process.exit(1)
  }
}

/**
 * The plugin runs once per bundle, but the work below is keyed on the package rather than on the
 * bundle: every bundle of a package compiles the same tsconfig into the same `outDir`, and bundles
 * that share an `outfile` extract the same types to the same path. Sharing one promise per key
 * keeps concurrent bundles from writing over each other's output, and does the work once.
 *
 * The caches belong to a single batch of bundles, so that a later batch recompiles rather than
 * reusing declarations emitted from sources that have since changed.
 */
export type TypeEmissionCache = {
  compilations: Map<string, Promise<unknown>>
  typeBundles: Map<string, Promise<void>>
}

export function createTypeEmissionCache(): TypeEmissionCache {
  return { compilations: new Map(), typeBundles: new Map() }
}

function once<T>(cache: Map<string, Promise<T>>, key: string, fn: () => T | Promise<T>): Promise<T> {
  let pending = cache.get(key)

  if (pending === undefined) {
    pending = Promise.resolve().then(fn)
    cache.set(key, pending)
  }

  return pending
}

/**
 * Triggers the TypeScript compiler and the type bundler.
 */
export const tscPlugin: (emitTypes: boolean | undefined, cache: TypeEmissionCache) => esbuild.Plugin = (
  emitTypes,
  cache,
) => ({
  name: 'tscPlugin',
  setup(build) {
    const options = build.initialOptions

    if (emitTypes === false) return // build has opted out of emitting types

    build.onStart(async () => {
      // we only call tsc if not in watch mode or in dev mode (they skip types)
      if (process.env.WATCH !== 'true' && process.env.DEV !== 'true') {
        // --paths null basically prevents typescript from using paths from the
        // tsconfig.json that is passed from the esbuild config. We need to do
        // this because TS would include types from the paths into this build.
        // but our paths, in our specific case only represent separate packages.
        await once(cache.compilations, `${options.tsconfig}`, () =>
          run(`tsc --project ${options.tsconfig} --paths null`),
        )
      }

      // we bundle types if we also bundle the entry point and it is a ts file
      if (options.bundle && options.outfile && options.entryPoints?.[0].endsWith('.ts')) {
        const tsconfig = require(`${process.cwd()}/${options.tsconfig}`) // tsconfig
        const typeOutDir = tsconfig?.compilerOptions?.outDir ?? '.' // type out dir
        const entryPoint = options.entryPoints?.[0].replace(/\.ts$/, '')
        const bundlePath = options.outfile.replace(/\.m?js$/, '')
        const typeOutPath = [
          `${process.cwd()}/${typeOutDir}/${entryPoint}.d.ts`,
          `${process.cwd()}/${typeOutDir}/${entryPoint.replace(/^src\//, '')}.d.ts`,
        ].filter(fs.existsSync)[0]

        const ext = options.format === 'esm' ? 'd.mts' : 'd.ts'
        if (process.env.WATCH !== 'true' && process.env.DEV !== 'true') {
          // we get the types generated by tsc and bundle them near the output
          const typeBundlePath = `${bundlePath}.d.ts`
          const outPath = `${bundlePath}.${ext}`

          await once(cache.typeBundles, bundlePath, () =>
            bundleTypeDefinitions(typeOutPath, bundlePath, options.external ?? []),
          )

          // the extractor already wrote `typeBundlePath`, so the cjs bundle has nothing left to
          // copy. Rewriting it in place would truncate the file another format is reading from.
          if (outPath !== typeBundlePath) {
            await fs.outputFile(outPath, await fs.readFile(typeBundlePath, 'utf-8'))
          }
        } else {
          // in watch mode, it wouldn't be viable to bundle the types every time
          // we haven't built any types with tsc at this stage, but we want types
          // we link the types locally by re-exporting them from the entry point
          await fs.outputFile(`${bundlePath}.${ext}`, `export * from '${process.cwd()}/${entryPoint}'`)
        }
      }
    })
  },
})

/**
 * Automatically get the type dependency package name, following the
 * DefinitelyTyped naming conventions.
 * @param npmPackage
 * @returns
 */
function getTypeDependencyPackageName(npmPackage: string) {
  if (npmPackage.startsWith('@')) {
    const [scope, name] = npmPackage.split('/')

    return `@types/${scope.slice(1)}__${name}`
  } else {
    return `@types/${npmPackage}`
  }
}
