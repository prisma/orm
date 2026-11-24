import { isCurrentBinInstalledGlobally } from '@prisma/internals'
import fs from 'fs'
import { bold, yellow } from 'kleur/colors'
import path from 'path'

import {
  type CliDistributionIdentity,
  type CliDistributionPackageName,
  getCliDistributionPackageName,
} from './cli-distribution-identity'

type LocalPackageName = CliDistributionPackageName | '@prisma/client'

export type GlobalLocalVersionMismatchWarningOptions = {
  cwd?: string
  globalVersion: string
  identity: CliDistributionIdentity
  isGlobalInstall?: () => 'npm' | false
  getInstalledPackageVersion?: (packageName: LocalPackageName, cwd: string) => Promise<string | null>
}

type LocalPackageVersionMismatch = {
  packageName: LocalPackageName
  globalVersion: string
  localVersion: string
}

function getLocalPackageNames(identity: CliDistributionIdentity): LocalPackageName[] {
  return [getCliDistributionPackageName(identity), '@prisma/client']
}

export async function getGlobalLocalVersionMismatchWarning(
  options: GlobalLocalVersionMismatchWarningOptions,
): Promise<string | null> {
  const isGlobalInstall = options.isGlobalInstall ?? isCurrentBinInstalledGlobally
  if (!isGlobalInstall()) {
    return null
  }

  const globalVersion = options.globalVersion.trim()
  if (!globalVersion) {
    return null
  }

  const identity = options.identity
  const cwd = options.cwd ?? process.cwd()
  const getInstalledPackageVersion = options.getInstalledPackageVersion ?? getInstalledPackageVersionFromNodeModules
  const localVersions = await Promise.all(
    getLocalPackageNames(identity).map(async (packageName) => ({
      packageName,
      version: await getInstalledPackageVersion(packageName, cwd),
    })),
  )

  const mismatches = localVersions
    .map(({ packageName, version }): LocalPackageVersionMismatch | null =>
      version && version !== globalVersion ? { packageName, globalVersion, localVersion: version } : null,
    )
    .filter((mismatch): mismatch is LocalPackageVersionMismatch => mismatch !== null)

  return mismatches.length > 0 ? formatGlobalLocalVersionMismatchWarning(mismatches, identity) : null
}

export async function getInstalledPackageVersionFromNodeModules(
  packageName: LocalPackageName,
  cwd: string = process.cwd(),
): Promise<string | null> {
  try {
    const packageJsonPath = await findPackageJsonFromNodeModules(packageName, cwd)
    if (!packageJsonPath) {
      return null
    }

    const packageJsonString = await fs.promises.readFile(packageJsonPath, 'utf-8')
    const packageJson = JSON.parse(packageJsonString) as { version?: unknown }

    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
}

async function findPackageJsonFromNodeModules(packageName: LocalPackageName, cwd: string): Promise<string | null> {
  let currentDir = path.resolve(cwd)
  const packageJsonSegments = ['node_modules', ...packageName.split('/'), 'package.json']

  while (true) {
    const packageJsonPath = path.join(currentDir, ...packageJsonSegments)
    try {
      await fs.promises.access(packageJsonPath, fs.constants.F_OK)
      return packageJsonPath
    } catch {
      // Keep walking parent directories until a local install is found.
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

function formatGlobalLocalVersionMismatchWarning(
  mismatches: LocalPackageVersionMismatch[],
  identity: CliDistributionIdentity,
): string {
  const globalVersion = mismatches[0].globalVersion
  const localVersions = mismatches
    .map(({ packageName, localVersion }) => bold(`${packageName}@${localVersion}`))
    .join(' and ')
  const packageLabel = mismatches.length === 1 ? 'package' : 'packages'

  return `${yellow(bold('warn'))} The globally installed ${bold(
    `${getCliDistributionPackageName(identity)}@${globalVersion}`,
  )} does not match the local ${packageLabel} ${localVersions} installed in this project.
This may generate Prisma Client artifacts that are incompatible with the local runtime.
Run ${bold(`npx ${identity} generate`)} to use the local Prisma CLI, or align your global and local Prisma versions.`
}
