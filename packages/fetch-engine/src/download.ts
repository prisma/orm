import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import Debug from '@prisma/debug'
import { BinaryTarget, binaryTargets, getPlatformInfo } from '@prisma/get-platform'
import { execa } from 'execa'
import { ensureDir } from 'fs-extra'
import { bold, yellow } from 'kleur/colors'
import pFilter from 'p-filter'
import tempDir from 'temp-dir'

import { BinaryType } from './BinaryType'
import { chmodPlusX } from './chmodPlusX'
import { cleanupCache } from './cleanupCache'
import { downloadZip } from './downloadZip'
import { getBinaryEnvVarPath } from './env'
import { getHash } from './getHash'
import { getBar } from './log'
import { getCacheDir, getDownloadUrl, overwriteFile } from './utils'

const { enginesOverride } = require('../package.json')

const debug = Debug('prisma:fetch-engine:download')
const exists = promisify(fs.exists)

const channel = 'master'

// matches `/snapshot/` or `C:\\snapshot\\` or `C:/snapshot/` for vercel's pkg apps
export const vercelPkgPathRegex = /^((\w:[\\\/])|\/)snapshot[\/\\]/

export type BinaryDownloadConfiguration = {
  [binary in BinaryType]?: string // that is a path to the binary download location
}

export type BinaryPaths = {
  [binary in BinaryType]?: { [binaryTarget in BinaryTarget]: string } // key: target, value: path
}

export interface DownloadOptions {
  binaries: BinaryDownloadConfiguration
  binaryTargets?: BinaryTarget[]
  showProgress?: boolean
  progressCb?: (progress: number) => void
  version?: string
  skipDownload?: boolean
  failSilent?: boolean
  printVersion?: boolean
  skipCacheIntegrityCheck?: boolean
}

type BinaryDownloadJob = {
  binaryName: string
  targetFolder: string
  binaryTarget: BinaryTarget
  fileName: string
  targetFilePath: string
  envVarPath: string | undefined
  skipCacheIntegrityCheck: boolean
}

export async function download(options: DownloadOptions): Promise<BinaryPaths> {
  // no need to do anything, if there are no binaries
  if (!options.binaries || Object.values(options.binaries).length === 0) {
    return {} // we don't download anything if nothing is provided
  }

  if (enginesOverride?.['branch'] || enginesOverride?.['folder']) {
    // if this is true the engines have been fetched before and already cached
    // into .cache/prisma/master/_local_ for us to be able to use this version
    options.version = '_local_'
    options.skipCacheIntegrityCheck = true
  }

  // get platform
  const { binaryTarget } = await getPlatformInfo()

  if (['freebsd11', 'freebsd12', 'freebsd13', 'freebsd14', 'freebsd15', 'openbsd', 'netbsd'].includes(binaryTarget)) {
    console.error(
      `${yellow(
        'Warning',
      )} Precompiled engine files are not available for ${binaryTarget}. Read more about building your own engines at https://pris.ly/d/build-engines`,
    )
  }

  // merge options
  const opts = {
    ...options,
    binaryTargets: options.binaryTargets ?? [binaryTarget],
    version: options.version ?? 'latest',
    binaries: options.binaries,
  }

  // creates a matrix of binaries x binary targets
  const binaryJobs = Object.entries(opts.binaries).flatMap(([binaryName, targetFolder]) =>
    opts.binaryTargets.map((binaryTarget) => {
      const fileName = getBinaryName(binaryName as BinaryType, binaryTarget)
      const targetFilePath = path.join(targetFolder, fileName)
      return {
        binaryName,
        targetFolder,
        binaryTarget,
        fileName,
        targetFilePath,
        envVarPath: getBinaryEnvVarPath(binaryName as BinaryType)?.path,
        skipCacheIntegrityCheck: !!opts.skipCacheIntegrityCheck,
      }
    }),
  )

  if (process.env.BINARY_DOWNLOAD_VERSION) {
    debug(`process.env.BINARY_DOWNLOAD_VERSION is set to "${process.env.BINARY_DOWNLOAD_VERSION}"`)
    opts.version = process.env.BINARY_DOWNLOAD_VERSION
  }

  if (opts.printVersion) {
    console.log(`version: ${opts.version}`)
  }

  // filter out files, which don't yet exist or have to be created
  const binariesToDownload = await pFilter(binaryJobs, async (job) => {
    const needsToBeDownloaded = await binaryNeedsToBeDownloaded(job, binaryTarget, opts.version)
    const isSupported = binaryTargets.includes(job.binaryTarget as BinaryTarget)
    const shouldDownload =
      isSupported &&
      !job.envVarPath && // this is for custom binaries
      needsToBeDownloaded
    if (needsToBeDownloaded && !isSupported) {
      throw new Error(`Unknown binaryTarget ${job.binaryTarget} and no custom engine files were provided`)
    }
    return shouldDownload
  })

  if (binariesToDownload.length > 0) {
    const cleanupPromise = cleanupCache() // already start cleaning up while we download

    let finishBar: undefined | (() => void)
    let setProgress: undefined | ((sourcePath: string) => (progress: number) => void)

    if (opts.showProgress) {
      const collectiveBar = getCollectiveBar(opts)
      finishBar = collectiveBar.finishBar
      setProgress = collectiveBar.setProgress
    }

    const promises = binariesToDownload.map((job) => {
      const downloadUrl = getDownloadUrl({
        channel: 'all_commits',
        version: opts.version,
        binaryTarget: job.binaryTarget,
        binaryName: job.binaryName,
      })

      debug(`${downloadUrl} will be downloaded to ${job.targetFilePath}`)

      return downloadBinary({
        ...job,
        downloadUrl,
        version: opts.version,
        failSilent: opts.failSilent,
        progressCb: setProgress ? setProgress(job.targetFilePath) : undefined,
      })
    })

    await Promise.all(promises)

    await cleanupPromise // make sure, that cleanup finished
    if (finishBar) {
      finishBar()
    }
  }

  const binaryPaths = binaryJobsToBinaryPaths(binaryJobs)

  // this is necessary for pkg
  if (__dirname.match(vercelPkgPathRegex)) {
    for (const engineType in binaryPaths) {
      const binaryTargets = binaryPaths[engineType]
      for (const binaryTarget in binaryTargets) {
        const binaryPath = binaryTargets[binaryTarget]
        binaryTargets[binaryTarget] = await maybeCopyToTmp(binaryPath)
      }
    }
  }

  return binaryPaths
}

function getCollectiveBar(options: DownloadOptions): {
  finishBar: () => void
  setProgress: (sourcePath: string) => (progress: number) => void
} {
  const bar = getBar(`Downloading Prisma engines for ${options.binaryTargets?.map((p) => bold(p)).join(' and ')}`)

  const progressMap: { [key: string]: number } = {}
  // Object.values is faster than Object.keys
  const numDownloads = Object.values(options.binaries).length * Object.values(options?.binaryTargets ?? []).length
  const setProgress =
    (sourcePath: string) =>
    (progress): void => {
      progressMap[sourcePath] = progress
      const progressValues = Object.values(progressMap)
      const totalProgress =
        progressValues.reduce((acc, curr) => {
          return acc + curr
        }, 0) / numDownloads
      if (options.progressCb) {
        options.progressCb(totalProgress)
      }
      if (bar) {
        bar.update(totalProgress)
      }
    }

  return {
    setProgress,
    finishBar: (): void => {
      bar.update(1)
      bar.terminate()
    },
  }
}

function binaryJobsToBinaryPaths(jobs: BinaryDownloadJob[]): BinaryPaths {
  return jobs.reduce<BinaryPaths>((acc, job) => {
    if (!acc[job.binaryName]) {
      acc[job.binaryName] = {}
    }

    // if an env var path has been provided, prefer that one
    acc[job.binaryName][job.binaryTarget] = job.envVarPath || job.targetFilePath

    return acc
  }, {} as BinaryPaths)
}

async function binaryNeedsToBeDownloaded(
  job: BinaryDownloadJob,
  nativePlatform: string,
  version: string,
): Promise<boolean> {
  // If there is an ENV Override and the file exists then it does not need to be downloaded
  if (job.envVarPath && fs.existsSync(job.envVarPath)) {
    return false
  }
  // 1. Check if file exists
  const targetExists = await exists(job.targetFilePath)
  // 2. If exists, check, if cached file exists and is up to date and has same hash as file.
  // If not, copy cached file over
  const cachedFile = await getCachedBinaryPath({
    ...job,
    version,
  })

  if (cachedFile) {
    // for local development, when using `enginesOverride`
    // we don't have the sha256 hash, so we can't check it
    if (job.skipCacheIntegrityCheck === true) {
      await overwriteFile(cachedFile, job.targetFilePath)

      return false
    }

    const sha256FilePath = cachedFile + '.sha256'
    if (await exists(sha256FilePath)) {
      const sha256File = await fs.promises.readFile(sha256FilePath, 'utf-8')
      const sha256Cache = await getHash(cachedFile)
      if (sha256File === sha256Cache) {
        if (!targetExists) {
          debug(`copying ${cachedFile} to ${job.targetFilePath}`)

          // TODO Remove when https://github.com/docker/for-linux/issues/1015 is fixed
          // Workaround for https://github.com/prisma/prisma/issues/7037
          await fs.promises.utimes(cachedFile, new Date(), new Date())

          await overwriteFile(cachedFile, job.targetFilePath)
        }
        const targetSha256 = await getHash(job.targetFilePath)
        if (sha256File !== targetSha256) {
          debug(`overwriting ${job.targetFilePath} with ${cachedFile} as hashes do not match`)
          await overwriteFile(cachedFile, job.targetFilePath)
        }
        return false
      } else {
        return true
      }
    } else if (process.env.PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING) {
      debug(
        `the checksum file ${sha256FilePath} is missing but this was ignored because the PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING environment variable is set`,
      )
      if (targetExists) {
        return false
      }
      if (cachedFile) {
        debug(`copying ${cachedFile} to ${job.targetFilePath}`)
        await overwriteFile(cachedFile, job.targetFilePath)
        return false
      }
      return true
    } else {
      return true
    }
  }

  // If there is no cache and the file doesn't exist, we for sure need to download it
  if (!targetExists) {
    debug(`file ${job.targetFilePath} does not exist and must be downloaded`)

    return true
  }

  // 3. If same platform, check --version and compare to expected version
  if (job.binaryTarget === nativePlatform) {
    const currentVersion = await getVersion(job.targetFilePath, job.binaryName)

    if (currentVersion?.includes(version) !== true) {
      debug(`file ${job.targetFilePath} exists but its version is ${currentVersion} and we expect ${version}`)

      return true
    }
  }

  return false
}

export async function getVersion(enginePath: string, _binaryName: string) {
  try {
    const result = await execa(enginePath, ['--version'])
    return result.stdout
  } catch {}

  return undefined
}

export function getBinaryName(binaryName: BinaryType, binaryTarget: BinaryTarget): string {
  const extension = binaryTarget === 'windows' ? '.exe' : ''
  return `${binaryName}-${binaryTarget}${extension}`
}

type GetCachedBinaryOptions = BinaryDownloadJob & {
  version: string
  failSilent?: boolean
}

async function getCachedBinaryPath({
  version,
  binaryTarget,
  binaryName,
}: GetCachedBinaryOptions): Promise<string | null> {
  const cacheDir = await getCacheDir(channel, version, binaryTarget)
  if (!cacheDir) {
    return null
  }

  const cachedTargetPath = path.join(cacheDir, binaryName)

  if (!fs.existsSync(cachedTargetPath)) {
    return null
  }

  // All versions not called 'latest' are unique
  // only latest needs more checks
  if (version !== 'latest') {
    return cachedTargetPath
  }

  if (await exists(cachedTargetPath)) {
    return cachedTargetPath
  }

  return null
}

type DownloadBinaryOptions = BinaryDownloadJob & {
  version: string
  downloadUrl: string
  progressCb?: (progress: number) => void
  failSilent?: boolean
}

async function downloadBinary(options: DownloadBinaryOptions): Promise<void> {
  const { version, progressCb, targetFilePath, downloadUrl } = options

  const targetDir = path.dirname(targetFilePath)

  try {
    fs.accessSync(targetDir, fs.constants.W_OK)
    await ensureDir(targetDir)
  } catch (e) {
    if (options.failSilent || (e as NodeJS.ErrnoException).code !== 'EACCES') {
      return
    } else {
      throw new Error(`Can't write to ${targetDir} please make sure you install "prisma" with the right permissions.`)
    }
  }

  debug(`Downloading ${downloadUrl} to ${targetFilePath} ...`)

  if (progressCb) {
    progressCb(0)
  }

  const { sha256, zippedSha256 } = await downloadZip(downloadUrl, targetFilePath, progressCb)
  if (progressCb) {
    progressCb(1)
  }

  chmodPlusX(targetFilePath)

  // Cache result
  await saveFileToCache(options, version, sha256, zippedSha256)
}

async function saveFileToCache(
  job: BinaryDownloadJob,
  version: string,
  sha256: string | null,
  zippedSha256: string | null,
): Promise<void> {
  // always fail silent, as the cache is optional
  const cacheDir = await getCacheDir(channel, version, job.binaryTarget)
  if (!cacheDir) {
    return
  }

  const cachedTargetPath = path.join(cacheDir, job.binaryName)
  const cachedSha256Path = path.join(cacheDir, job.binaryName + '.sha256')
  const cachedSha256ZippedPath = path.join(cacheDir, job.binaryName + '.gz.sha256')

  try {
    await overwriteFile(job.targetFilePath, cachedTargetPath)
    if (sha256 != null) {
      await fs.promises.writeFile(cachedSha256Path, sha256)
    }
    if (zippedSha256 != null) {
      await fs.promises.writeFile(cachedSha256ZippedPath, zippedSha256)
    }
  } catch (e) {
    debug(e)
    // let this fail silently - the CI system may have reached the file size limit
  }
}

export async function maybeCopyToTmp(file: string): Promise<string> {
  // in this case, we are in a "pkg" context with a virtual fs
  // to make this work, we need to copy the binary to /tmp and execute it from there

  if (__dirname.match(vercelPkgPathRegex)) {
    const targetDir = path.join(tempDir, 'prisma-binaries')
    await ensureDir(targetDir)
    const target = path.join(targetDir, path.basename(file))
    const data = await fs.promises.readFile(file)
    await fs.promises.writeFile(target, data)
    // We have to read and write until https://github.com/zeit/pkg/issues/639
    // is resolved
    // await copyFile(file, target)
    plusX(target)
    return target
  }

  return file
}

export function plusX(file): void {
  const s = fs.statSync(file)
  const newMode = s.mode | 64 | 8 | 1
  if (s.mode === newMode) {
    return
  }
  const base8 = newMode.toString(8).slice(-3)
  fs.chmodSync(file, base8)
}
