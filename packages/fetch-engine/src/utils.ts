import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Debug from '@prisma/debug'
import { BinaryTarget } from '@prisma/get-platform'
import findCacheDir from 'find-cache-dir'
import { ensureDir } from 'fs-extra'

const debug = Debug('prisma:fetch-engine:cache-dir')

export async function getRootCacheDir(): Promise<string | null> {
  if (os.platform() === 'win32') {
    // `APPDATA` is a stable, user-level directory outside of any `node_modules` folder, so prefer it over
    // `find-cache-dir`, which resolves a cache dir relative to the nearest `package.json` from `process.cwd()`.
    // That makes it dependent on which package happens to trigger the download (e.g. `@prisma/engines`'s own
    // postinstall script vs. running the `prisma` CLI later), so it can create multiple, duplicate cache
    // directories nested inside `node_modules` that then get needlessly bundled into deployments.
    // See https://github.com/prisma/prisma/issues/22574, https://github.com/prisma/prisma/issues/6670,
    // https://github.com/prisma/prisma/issues/11577
    if (process.env.APPDATA) {
      return path.join(process.env.APPDATA, 'Prisma')
    }
    const cacheDir = findCacheDir({ name: 'prisma', create: true })
    if (cacheDir) {
      return cacheDir
    }
  }
  // if this is lambda, nope
  if (process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    try {
      await ensureDir(`/tmp/prisma-download`)
      return `/tmp/prisma-download`
    } catch (e) {
      return null
    }
  }
  return process.env.XDG_CACHE_HOME
    ? path.join(process.env.XDG_CACHE_HOME, 'prisma')
    : path.join(os.homedir(), '.cache/prisma')
}

export async function getCacheDir(channel: string, version: string, binaryTarget: string): Promise<string | null> {
  const rootCacheDir = await getRootCacheDir()
  if (!rootCacheDir) {
    return null
  }
  const cacheDir = path.join(rootCacheDir, channel, version, binaryTarget)
  try {
    if (!fs.existsSync(cacheDir)) {
      await ensureDir(cacheDir)
    }
  } catch (e) {
    debug('The following error is being caught and just there for debugging:')
    debug(e)
    return null
  }
  return cacheDir
}

export function getDownloadUrl({
  channel,
  version,
  binaryTarget,
  binaryName,
  extension = '.gz',
}: {
  channel: string
  version: string
  binaryTarget: BinaryTarget
  binaryName: string
  extension?: string
}): string {
  const baseUrl =
    process.env.PRISMA_BINARIES_MIRROR || // TODO: remove this
    process.env.PRISMA_ENGINES_MIRROR ||
    'https://binaries.prisma.sh'

  const finalExtension = binaryTarget === 'windows' ? `.exe${extension}` : extension

  return `${baseUrl}/${channel}/${version}/${binaryTarget}/${binaryName}${finalExtension}`
}

export async function overwriteFile(sourcePath: string, targetPath: string) {
  // without removing the file first,
  // macOS Gatekeeper can sometimes complain
  // about incorrect binary signature and kill node process
  // https://openradar.appspot.com/FB8914243
  if (os.platform() === 'darwin') {
    await removeFileIfExists(targetPath)
    await fs.promises.copyFile(sourcePath, targetPath)
  } else {
    const tempPath = `${targetPath}.tmp${process.pid}`
    await fs.promises.copyFile(sourcePath, tempPath)
    await fs.promises.rename(tempPath, targetPath)
  }
}

async function removeFileIfExists(filePath: string) {
  try {
    await fs.promises.unlink(filePath)
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e
    }
  }
}
