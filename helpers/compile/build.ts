import { ChokidarOptions, watch as createWatcher } from 'chokidar'
import * as esbuild from 'esbuild'
import { BuildContext } from 'esbuild'
import { writeFileSync } from 'fs'
import glob from 'globby'
import path from 'path'

import { debounce } from '../blaze/debounce'
import { flatten } from '../blaze/flatten'
import { handle } from '../blaze/handle'
import { map } from '../blaze/map'
import { omit } from '../blaze/omit'
import { pipe } from '../blaze/pipe'
import { fixImportsPlugin } from './plugins/fixImportsPlugin'
import { onErrorPlugin } from './plugins/onErrorPlugin'
import { resolvePathsPlugin } from './plugins/resolvePathsPlugin'
import { createTypeEmissionCache, tscPlugin, TypeEmissionCache } from './plugins/tscPlugin'

export type BuildResult = esbuild.BuildResult
export type BuildOptions = esbuild.BuildOptions & {
  name?: string
  emitTypes?: boolean
  emitMetafile?: boolean
  outbase?: never // we don't support this
}

const DEFAULT_BUILD_OPTIONS = {
  platform: 'node',
  target: 'ES2022',
  logLevel: 'error',
  tsconfig: 'tsconfig.build.json',
  metafile: true,
} as const

/**
 * Apply defaults to the original build options
 * @param options the original build options
 */
const applyDefaults = (options: BuildOptions, typeEmission: TypeEmissionCache): BuildOptions => ({
  ...DEFAULT_BUILD_OPTIONS,
  format: 'cjs',
  outExtension: { '.js': '.js' },
  resolveExtensions: ['.ts', '.js', '.node'],
  entryPoints: glob.sync('./src/**/*.{j,t}s', {
    ignore: ['./src/__tests__/**/*'],
  }),
  mainFields: ['module', 'main'],
  ...options,
  // outfile has precedence over outdir, hence these ternaries
  outfile: options.outfile ? getOutFile(options) : undefined,
  outdir: options.outfile ? undefined : getOutDir(options),
  plugins: [
    ...(options.plugins ?? []),
    resolvePathsPlugin,
    fixImportsPlugin,
    tscPlugin(options.emitTypes, typeEmission),
    onErrorPlugin,
  ],
  external: [...(options.external ?? []), ...getProjectExternals(options)],
})

/**
 * Create two deferred builds for esm and cjs. The one follows the other:
 * - 1. The code gets compiled to an optimized tree-shaken esm output
 * - 2. We take that output and compile it to an optimized cjs output
 * @param options the original build options
 * @returns if options = [a, b], we get [a-esm, a-cjs, b-esm, b-cjs]
 */
function createBuildOptions(options: BuildOptions[], typeEmission: TypeEmissionCache) {
  return flatten(
    map(options, (options) => [
      // we defer it so that we don't trigger glob immediately
      () => applyDefaults(options, typeEmission),
      // ... here can go more steps
    ]),
  )
}

/**
 * Resolves a deferred build options object, running the glob search it carries.
 */
function computeOptions(options: () => BuildOptions) {
  return options()
}

/**
 * Extensions are not automatically by esbuild set for `options.outfile`. We
 * look at the set `options.outExtension` and we add that to `options.outfile`.
 */
function addExtensionFormat(options: BuildOptions) {
  if (options.outfile && options.outExtension) {
    const ext = options.outExtension['.js']

    options.outfile = `${options.outfile}${ext}`
  }

  return options
}

/**
 * If we don't have `options.outfile`, we default `options.outdir`
 */
function addDefaultOutDir(options: BuildOptions) {
  if (options.outfile === undefined) {
    options.outdir = getOutDir(options)
  }

  return options
}

/**
 * Execute esbuild with all the configurations we pass
 */
async function executeEsBuild(options: BuildOptions) {
  if (process.env.WATCH === 'true') {
    const context = await esbuild.context(omit(options, ['name', 'emitTypes', 'emitMetafile']) as any)

    watch(context, options)
  }

  const build = await esbuild.build(omit(options, ['name', 'emitTypes', 'emitMetafile']) as any)
  const outdir = options.outdir ?? (options.outfile ? path.dirname(options.outfile) : undefined)

  if (build.metafile && options.emitMetafile) {
    const metafilePath = `${outdir}/${options.name}.meta.json`
    writeFileSync(metafilePath, JSON.stringify(build.metafile))
  }

  return [options, build] as const
}

/**
 * Execution pipeline that applies a set of actions
 * @param options
 */
export async function build(options: BuildOptions[]) {
  const buildOptions = createBuildOptions(options, createTypeEmissionCache())
  const progress: Progress = { done: 0, total: buildOptions.length }

  return Promise.all(
    buildOptions.map(
      pipe.async(
        computeOptions,
        logStartBuild,
        addExtensionFormat,
        addDefaultOutDir,
        executeEsBuild,
        logEndBuild(progress),
      ),
    ),
  )
}

/**
 * Prints a message every time a new bundle starts to build
 */
function logStartBuild(options: BuildOptions): BuildOptions {
  console.log(`Building ${options.name} as ${options.format ?? 'cjs'}...`)
  return options
}

type Progress = {
  done: number
  readonly total: number
}

/**
 * Prints a message every time a bundle is finished building
 */
function logEndBuild(progress: Progress) {
  return ([options, result]: readonly [BuildOptions, esbuild.BuildResult]): [BuildOptions, esbuild.BuildResult] => {
    console.log(`Built ${options.name} as ${options.format ?? 'cjs'} (${++progress.done}/${progress.total})`)
    return [options, result]
  }
}

/**
 * Executes the build and rebuilds what is necessary
 * @param builds
 */
const watch = (context: BuildContext, options: BuildOptions) => {
  if (process.env.WATCH !== 'true') return context

  // common chokidar options for the watchers
  const config = {
    ignoreInitial: true,
    ignored: [/$src\/__tests__\//, 'package.json'],
  } satisfies ChokidarOptions

  // prepare the incremental builds watcher
  const changeWatcher = createWatcher(['./src'], config)

  // triggers quick rebuild on file change
  const fastRebuild = debounce(async () => {
    const timeBefore = Date.now()

    // we handle possible rebuild exceptions
    const rebuildResult = await handle.async(() => {
      return context.rebuild()
    })

    // Handle unexpected internal errors
    if (rebuildResult instanceof Error) {
      console.error(rebuildResult)
      // Handle build errors (e.g., syntax errors)
    } else if (rebuildResult.errors.length > 0) {
      // Log the detailed error object from esbuild for better debugging.
      console.error(rebuildResult.errors)
    }

    console.log(`${Date.now() - timeBefore}ms [${options.name ?? ''}]`)
  }, 10)

  changeWatcher.on('change', fastRebuild)

  return undefined
}

// Utils ::::::::::::::::::::::::::::::::::::::::::::::::::

// get a default directory if needed (no outfile)
function getOutDir(options: BuildOptions) {
  if (options.outfile !== undefined) {
    return path.dirname(options.outfile)
  }

  return options.outdir ?? 'dist'
}

// get the output file from an original path
function getOutFile(options: BuildOptions) {
  if (options.outfile !== undefined) {
    const dirname = getOutDir(options)
    const filename = path.basename(options.outfile)

    return `${dirname}/${filename}`
  }

  return undefined
}

// get the current project externals this helps to mark dependencies as external
// by having convention in the package.json (dev = bundled, non-dev = external)
function getProjectExternals(options: BuildOptions) {
  const pkg = require(`${process.cwd()}/package.json`)
  const peerDeps = Object.keys(pkg.peerDependencies ?? {})
  const regDeps = Object.keys(pkg.dependencies ?? {})

  // when bundling, only the devDeps will be bundled
  if (!process.env.IGNORE_EXTERNALS && options.bundle === true) {
    return [...new Set([...peerDeps, ...regDeps])]
  }

  // otherwise, all the dependencies will be bundled
  return []
}
