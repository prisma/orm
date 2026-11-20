import { getEnginesPath } from '@prisma/engines'
import { BinaryType, engineEnvVarMap, getBinaryEnvVarPath } from '@prisma/fetch-engine'
import { getBinaryTargetForCurrentPlatform } from '@prisma/get-platform'
import * as TE from 'fp-ts/TaskEither'
import fs from 'fs'
import { ensureDir } from 'fs-extra'
import path from 'path'
import tempDir from 'temp-dir'

import { chmodPlusX } from './utils/chmodPlusX'
import { vercelPkgPathRegex } from './utils/vercelPkgPathRegex'

export { BinaryType, engineEnvVarMap }

async function getBinaryName(name: BinaryType): Promise<string> {
  const binaryTarget = await getBinaryTargetForCurrentPlatform()
  const extension = binaryTarget === 'windows' ? '.exe' : ''
  return `${name}-${binaryTarget}${extension}`
}

export async function resolveBinary(name: BinaryType, proposedPath?: string): Promise<string> {
  // if file exists at proposedPath (and does not start with `/snapshot/` (= pkg), use that one
  if (proposedPath && !proposedPath.match(vercelPkgPathRegex) && fs.existsSync(proposedPath)) {
    return proposedPath
  }

  // If engine path was provided via env var, check and use that one
  const pathFromEnvVar = getBinaryEnvVarPath(name)
  if (pathFromEnvVar !== null) {
    return pathFromEnvVar.path
  }

  // If still here, try different paths
  const binaryName = await getBinaryName(name)

  const prismaPath = path.join(getEnginesPath(), binaryName)
  if (fs.existsSync(prismaPath)) {
    return maybeCopyToTmp(prismaPath)
  }

  // for pkg (related: https://github.com/vercel/pkg#snapshot-filesystem)
  const prismaPath2 = path.join(__dirname, '..', binaryName)
  if (fs.existsSync(prismaPath2)) {
    return maybeCopyToTmp(prismaPath2)
  }

  // TODO for ??
  const prismaPath3 = path.join(__dirname, '../..', binaryName)
  if (fs.existsSync(prismaPath3)) {
    return maybeCopyToTmp(prismaPath3)
  }

  // fallback for an engine placed in a sibling `runtime` directory next to the bundle
  const prismaPath4 = path.join(__dirname, '../runtime', binaryName)
  if (fs.existsSync(prismaPath4)) {
    return maybeCopyToTmp(prismaPath4)
  }

  // Still here? Could not find the engine, so error out.
  throw new Error(
    `Could not find ${name} binary. Searched in:
- ${prismaPath}
- ${prismaPath2}
- ${prismaPath3}
- ${prismaPath4}`,
  )
}

export function safeResolveBinary(name: BinaryType, proposedPath?: string): TE.TaskEither<Error, string> {
  return TE.tryCatch(
    () => resolveBinary(name, proposedPath),
    (error) => error as Error,
  )
}

export async function maybeCopyToTmp(file: string): Promise<string> {
  if (__dirname.match(vercelPkgPathRegex)) {
    // In this case, we are in a "pkg" context with a simulated fs.
    // We can't execute a binary from here because it's not a real
    // file system but rather something implemented on JavaScript
    // side, and the operating system cannot work with it, so we have
    // to copy the binary to /tmp and execute it from there.
    const targetDir = path.join(tempDir, 'prisma-binaries')
    await ensureDir(targetDir)
    const target = path.join(targetDir, path.basename(file))

    // We have to read and write until https://github.com/zeit/pkg/issues/639 is resolved
    const data = await fs.promises.readFile(file)
    await fs.promises.writeFile(target, data)
    // TODO Undo when https://github.com/vercel/pkg/pull/1484 is released
    // await copyFile(file, target)

    chmodPlusX(target)
    return target
  }

  return file
}
