import fs from 'node:fs'

import type * as esbuild from 'esbuild'
import path from 'path'

type TsConfig = {
  compilerOptions?: {
    paths?: Record<string, string[]>
  }
  extends?: string
}

/**
 * Recursive function to resolve the paths config from a tsconfig.json, whether
 * it is in the config directly or via an inherited config (via "extends").
 * @param options
 * @param cwd
 * @returns
 */
function resolvePathsConfig(options: TsConfig, cwd: string) {
  if (options?.compilerOptions?.paths) {
    const paths = Object.entries(options.compilerOptions.paths)

    const resolvedPaths = paths.map(([key, paths]) => {
      return [key, paths.map((v) => path.resolve(cwd, v))] as const
    })

    return Object.fromEntries(resolvedPaths)
  }

  if (options.extends) {
    const extendsPath = path.resolve(cwd, options.extends)
    const extendsDir = path.dirname(extendsPath)
    const extendsConfig = require(extendsPath)

    return resolvePathsConfig(extendsConfig, extendsDir)
  }

  return {}
}

/**
 * Forces `esbuild` to always use the TS compiler paths, even when we are
 * bundling a local dependency of a local dependency, ensuring maximum
 * tree-shaking. Note: `esbuild` has some support for this, though it is limited
 * in the amount of dependency nesting it supports.
 */
function resolvePathTarget(target: string) {
  if (path.extname(target) !== '') {
    return target
  }

  const fileTarget = `${target}.ts`

  return fs.existsSync(fileTarget) ? fileTarget : path.join(target, 'index.ts')
}

type TsPathAlias = {
  filterSource: string
  matcher: RegExp
  resolve: (importPath: string) => string
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createPathAlias(key: string, target: string): TsPathAlias {
  const wildcardIndex = key.indexOf('*')

  if (wildcardIndex === -1) {
    const filterSource = escapeRegex(key)

    return {
      filterSource,
      matcher: new RegExp(`^${filterSource}$`),
      resolve: () => target,
    }
  }

  const prefix = key.slice(0, wildcardIndex)
  const suffix = key.slice(wildcardIndex + 1)
  const filterSource = `${escapeRegex(prefix)}.*${escapeRegex(suffix)}`
  const matcher = new RegExp(`^${escapeRegex(prefix)}(.*)${escapeRegex(suffix)}$`)

  return {
    filterSource,
    matcher,
    resolve: (importPath) => {
      const wildcard = matcher.exec(importPath)?.[1] ?? ''
      return target.replace('*', wildcard)
    },
  }
}

function createPathAliases(paths: Record<string, string[]>) {
  return Object.entries(paths).map(([key, targets]) => createPathAlias(key, targets[0]))
}

export const resolvePathsPlugin: esbuild.Plugin = {
  name: 'resolvePathsPlugin',
  setup(build) {
    const parentTsConfig = require(`${process.cwd()}/${build.initialOptions.tsconfig}`)
    const resolvedTsPaths = resolvePathsConfig(parentTsConfig, process.cwd())
    const pathAliases = createPathAliases(resolvedTsPaths)
    const packagesRegex = new RegExp(`^(?:${pathAliases.map((alias) => alias.filterSource).join('|')})$`)

    build.onResolve({ filter: packagesRegex }, (args) => {
      if (build.initialOptions.external?.includes(args.path)) {
        return { path: args.path, external: true }
      }

      const alias = pathAliases.find((candidate) => candidate.matcher.test(args.path))

      if (!alias) {
        return null
      }

      return { path: resolvePathTarget(alias.resolve(args.path)) }
    })
  },
}
