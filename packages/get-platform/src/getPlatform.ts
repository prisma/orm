import Debug from '@prisma/debug'
import cp from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import { match } from 'ts-pattern'
import { promisify } from 'util'

import { BinaryTarget } from './binaryTargets'
import { warn } from './logger'

const exec = promisify(cp.exec)

const debug = Debug('prisma:get-platform')

const supportedLibSSLVersions = ['1.0.x', '1.1.x', '3.0.x'] as const

// https://www.geeksforgeeks.org/node-js-process-arch-property/
export type Arch = 'x32' | 'x64' | 'arm' | 'arm64' | 's390' | 's390x' | 'mipsel' | 'ia32' | 'mips' | 'ppc' | 'ppc64'
export type DistroInfo = {
  /**
   * The original distro is the Linux distro name detected via its release file.
   * E.g., on Arch Linux, the original distro is `arch`. On Linux Alpine, the original distro is `alpine`.
   */
  originalDistro?: string

  /**
   * The family distro is the Linux distro name that is used to determine Linux families based on the same base distro, and likely using the same package manager.
   * E.g., both Ubuntu and Debian belong to the `debian` family of distros, and thus rely on the same package manager (`apt`).
   */
  familyDistro?: string

  /**
   * The target distro is the Linux distro associated with the Prisma Engines.
   * E.g., on Arch Linux, Debian, and Ubuntu, the target distro is `debian`. On Linux Alpine, the target distro is `musl`.
   */
  targetDistro?:
    | 'rhel'
    | 'debian'
    | 'musl'
    | 'arm'
    | 'freebsd11'
    | 'freebsd12'
    | 'freebsd13'
    | 'freebsd14'
    | 'freebsd15'
}
type GetOsResultLinux = {
  platform: 'linux'
  arch: Arch
  archFromUname: string | undefined
  /**
   * Starting from version 3.0, OpenSSL is basically adopting semver, and will be API and ABI compatible within a major version.
   */
  libssl?: (typeof supportedLibSSLVersions)[number]
} & DistroInfo

export type GetOSResult =
  | {
      platform: Omit<NodeJS.Platform, 'linux'>
      arch: Arch
      targetDistro?: DistroInfo['targetDistro']
      familyDistro?: never
      originalDistro?: never
      archFromUname?: never
      libssl?: never
    }
  | GetOsResultLinux

/**
 * For internal use only. This public export will be eventually removed in favor of `getPlatformWithOSResult`.
 */
export async function getos(): Promise<GetOSResult> {
  const platform = os.platform()
  const arch = process.arch as Arch
  if (platform === 'freebsd') {
    const version = await getCommandOutput(`freebsd-version`)
    if (version && version.trim().length > 0) {
      const regex = /^(\d+)\.?/
      const match = regex.exec(version)
      if (match) {
        return {
          platform: 'freebsd',
          targetDistro: `freebsd${match[1]}` as GetOSResult['targetDistro'],
          arch,
        }
      }
    }
  }

  if (platform !== 'linux') {
    return {
      platform,
      arch,
    }
  }

  const distroInfo = await resolveDistro()
  const archFromUname = await getArchFromUname()
  const libsslSpecificPaths = computeLibSSLSpecificPaths({ arch, archFromUname, familyDistro: distroInfo.familyDistro })
  const { libssl } = await getSSLVersion(libsslSpecificPaths)

  return {
    platform: 'linux',
    libssl,
    arch,
    archFromUname,
    ...distroInfo,
  }
}

export function parseDistro(osReleaseInput: string): DistroInfo {
  const idRegex = /^ID="?([^"\n]*)"?$/im
  const idLikeRegex = /^ID_LIKE="?([^"\n]*)"?$/im

  const idMatch = idRegex.exec(osReleaseInput)
  const id = (idMatch && idMatch[1] && idMatch[1].toLowerCase()) || ''

  const idLikeMatch = idLikeRegex.exec(osReleaseInput)
  const idLike = (idLikeMatch && idLikeMatch[1] && idLikeMatch[1].toLowerCase()) || ''

  /**
   * Example output of /etc/os-release:
   *
   * Alpine Linux => ID=alpine                                     => targetDistro=musl, familyDistro=alpine
   * Raspbian     => ID=raspbian, ID_LIKE=debian                   => targetDistro=arm, familyDistro=debian
   * NixOS        => ID=nixos                                      => targetDistro=debian, familyDistro=nixos
   * Debian       => ID=debian                                     => targetDistro=debian, familyDistro=debian
   * Distroless   => ID=debian                                     => targetDistro=debian, familyDistro=debian
   * Ubuntu       => ID=ubuntu, ID_LIKE=debian                     => targetDistro=debian, familyDistro=debian
   * Arch Linux   => ID=arch                                       => targetDistro=debian, familyDistro=arch
   * Manjaro      => ID=manjaro, ID_LIKE=arch                      => targetDistro=debian, familyDistro=arch
   * Red Hat      => ID=rhel, ID_LIKE=fedora                       => targetDistro=rhel, familyDistro=rhel
   * Centos       => ID=centos, ID_LIKE=rhel fedora                => targetDistro=rhel, familyDistro=rhel
   * Alma Linux   => ID="almalinux", ID_LIKE="rhel centos fedora"  => targetDistro=rhel, familyDistro=rhel
   * Fedora       => ID=fedora                                     => targetDistro=rhel, familyDistro=rhel
   */
  const distroInfo = match({ id, idLike })
    .with(
      { id: 'alpine' },
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'musl',
          familyDistro: originalDistro,
          originalDistro,
        }) as const,
    )
    .with(
      { id: 'raspbian' },
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'arm',
          familyDistro: 'debian',
          originalDistro,
        }) as const,
    )
    .with(
      { id: 'nixos' },
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'debian',
          familyDistro: 'nixos',
          originalDistro,
        }) as const,
    )
    .with(
      { id: 'debian' },
      { id: 'ubuntu' },
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'debian',
          familyDistro: 'debian',
          originalDistro,
        }) as const,
    )
    .with(
      { id: 'rhel' },
      { id: 'centos' },
      { id: 'fedora' },
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'rhel',
          familyDistro: 'rhel',
          originalDistro,
        }) as const,
    )
    .when(
      ({ idLike }) => idLike.includes('debian') || idLike.includes('ubuntu'),
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'debian',
          familyDistro: 'debian',
          originalDistro,
        }) as const,
    )
    .when(
      ({ idLike }) => id === 'arch' || idLike.includes('arch'),
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'debian',
          familyDistro: 'arch',
          originalDistro,
        }) as const,
    )
    .when(
      ({ idLike }) =>
        idLike.includes('centos') || idLike.includes('fedora') || idLike.includes('rhel') || idLike.includes('suse'),
      ({ id: originalDistro }) =>
        ({
          targetDistro: 'rhel',
          familyDistro: 'rhel',
          originalDistro,
        }) as const,
    )
    .otherwise(({ id: originalDistro }) => {
      /* Generic distro info fallback */
      return {
        targetDistro: undefined,
        familyDistro: undefined,
        originalDistro,
      } as const
    })

  debug(`Found distro info:\n${JSON.stringify(distroInfo, null, 2)}`)
  return distroInfo
}

export async function resolveDistro(): Promise<DistroInfo> {
  // https://github.com/retrohacker/getos/blob/master/os.json

  const osReleaseFile = '/etc/os-release'
  try {
    const osReleaseInput = await fs.readFile(osReleaseFile, { encoding: 'utf-8' })
    return parseDistro(osReleaseInput)
  } catch (_) {
    return {
      targetDistro: undefined,
      familyDistro: undefined,
      originalDistro: undefined,
    }
  }
}

/**
 * Parse the OpenSSL version from the output of the openssl binary, e.g.
 * "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)" -> "3.0.x"
 */
export function parseOpenSSLVersion(input: string): GetOsResultLinux['libssl'] | undefined {
  const match = /^OpenSSL\s(\d+\.\d+)\.\d+/.exec(input)
  if (match) {
    const partialVersion = `${match[1]}.x`
    return sanitiseSSLVersion(partialVersion)
  }

  return undefined
}

/**
 * Parse the OpenSSL version from the output of the libssl.so file, e.g.
 * "libssl.so.3" -> "3.0.x"
 */
export function parseLibSSLVersion(input: string): GetOsResultLinux['libssl'] {
  const match = /libssl\.so\.(\d)(\.\d)?/.exec(input)
  if (match) {
    const partialVersion = `${match[1]}${match[2] ?? '.0'}.x`
    return sanitiseSSLVersion(partialVersion)
  }

  return undefined
}

function sanitiseSSLVersion(version: string): GetOsResultLinux['libssl'] {
  const sanitisedVersion = (() => {
    if (isLibssl1x(version)) {
      return version
    }

    /**
     * Sanitise OpenSSL 3+. E.g., '3.1.x' becomes '3.0.x'
     */
    const versionSplit = version.split('.')
    versionSplit[1] = '0'
    return versionSplit.join('.') as NonNullable<GetOsResultLinux['libssl']>
  })()

  /* Validate that we've parsed a libssl version we actually support */
  if (supportedLibSSLVersions.includes(sanitisedVersion)) {
    return sanitisedVersion
  }

  return undefined
}

type ComputeLibSSLSpecificPathsParams = {
  arch: Arch
  archFromUname: Awaited<ReturnType<typeof getArchFromUname>>
  familyDistro: DistroInfo['familyDistro']
}

export function computeLibSSLSpecificPaths(args: ComputeLibSSLSpecificPathsParams) {
  return match(args)
    .with({ familyDistro: 'alpine' }, () => {
      /* Linux Alpine */
      debug('Trying platform-specific paths for "alpine"')
      return ['/lib', '/usr/lib']
    })
    .with({ familyDistro: 'nixos' }, () => {
      /* NixOS (nix-ld lists libraries for foreign binaries in NIX_LD_LIBRARY_PATH) */
      debug('Trying platform-specific paths for "nixos"')
      return [
        ...new Set(
          [process.env.NIX_LD_LIBRARY_PATH, process.env.LD_LIBRARY_PATH].flatMap((value) =>
            (value ?? '').split(':').filter(Boolean),
          ),
        ),
      ]
    })
    .with({ familyDistro: 'debian' }, ({ archFromUname }) => {
      /* Linux Debian, Ubuntu, etc */
      debug('Trying platform-specific paths for "debian" (and "ubuntu")')
      return [`/usr/lib/${archFromUname}-linux-gnu`, `/lib/${archFromUname}-linux-gnu`]
    })
    .with({ familyDistro: 'rhel' }, () => {
      /* Linux Red Hat, OpenSuse etc */
      debug('Trying platform-specific paths for "rhel"')
      return ['/lib64', '/usr/lib64']
    })
    .otherwise(({ familyDistro, arch, archFromUname }) => {
      /* Other Linux distros, we don't do anything specific and fall back to the next blocks */
      debug(`Don't know any platform-specific paths for "${familyDistro}" on ${arch} (${archFromUname})`)
      return []
    })
}

type GetOpenSSLVersionResult =
  | {
      libssl: GetOsResultLinux['libssl']
      strategy: 'libssl-specific-path' | 'ldconfig' | 'openssl-binary'
    }
  | {
      libssl?: never
      strategy?: never
    }

/**
 * On Linux, returns the libssl version excluding the patch version, e.g. "1.1.x".
 * Reading the version from the libssl.so file is more reliable than reading it from the openssl binary.
 * Older versions of libssl are preferred, e.g. "1.0.x" over "1.1.x", because of Vercel serverless
 * having different build and runtime environments, with the runtime environment having an old version
 * of libssl, and the build environment having both that old version and a newer version of libssl installed.
 * Because of https://github.com/prisma/prisma/issues/17499, we explicitly filter out libssl 0.x.
 *
 * This function never throws.
 */
export async function getSSLVersion(libsslSpecificPaths: string[]): Promise<GetOpenSSLVersionResult> {
  const excludeLibssl0x = 'grep -v "libssl.so.0"'
  const libsslFilenameFromSpecificPath: string | undefined = await findLibSSLInLocations(libsslSpecificPaths)

  if (libsslFilenameFromSpecificPath) {
    debug(`Found libssl.so file using platform-specific paths: ${libsslFilenameFromSpecificPath}`)
    const libsslVersion = parseLibSSLVersion(libsslFilenameFromSpecificPath)
    debug(`The parsed libssl version is: ${libsslVersion}`)
    if (libsslVersion) {
      return { libssl: libsslVersion, strategy: 'libssl-specific-path' }
    }
  }

  debug('Falling back to "ldconfig" and other generic paths')
  let libsslFilename: string | undefined = await getCommandOutput(
    /**
     * The `ldconfig -p` returns the dynamic linker cache paths, where libssl.so files are likely to be included.
     * Each line looks like this:
     * 	libssl.so (libc6,hard-float) => /usr/lib/arm-linux-gnueabihf/libssl.so.1.1
     * But we're only interested in the filename, so we use sed to remove everything before the `=>` separator,
     * and then we remove the path and keep only the filename.
     * The second sed commands uses `|` as a separator because the paths may contain `/`, which would result in the
     * `unknown option to 's'` error (see https://stackoverflow.com/a/9366940/6174476) - which would silently
     * fail with error code 0.
     */
    `ldconfig -p | sed "s/.*=>s*//" | sed "s|.*/||" | grep libssl | sort | ${excludeLibssl0x}`,
  )

  if (!libsslFilename) {
    /**
     * Fall back to the rhel-specific paths (although `familyDistro` isn't detected as rhel) when the `ldconfig` command fails.
     */
    libsslFilename = await findLibSSLInLocations(['/lib64', '/usr/lib64', '/lib', '/usr/lib'])
  }

  if (libsslFilename) {
    debug(`Found libssl.so file using "ldconfig" or other generic paths: ${libsslFilename}`)
    const libsslVersion = parseLibSSLVersion(libsslFilename)
    debug(`The parsed libssl version is: ${libsslVersion}`)
    if (libsslVersion) {
      return { libssl: libsslVersion, strategy: 'ldconfig' }
    }
  }

  /* Reading the libssl.so version didn't work, fall back to openssl */

  const openSSLVersionLine: string | undefined = await getCommandOutput('openssl version -v')

  if (openSSLVersionLine) {
    debug(`Found openssl binary with version: ${openSSLVersionLine}`)
    const openSSLVersion = parseOpenSSLVersion(openSSLVersionLine)
    debug(`The parsed openssl version is: ${openSSLVersion}`)
    if (openSSLVersion) {
      return { libssl: openSSLVersion, strategy: 'openssl-binary' }
    }
  }

  /* Reading openssl didn't work */
  debug(`Couldn't find any version of libssl or OpenSSL in the system`)
  return {}
}

/**
 * Looks for libssl in specified directories, returns the first one found
 * @param directories
 * @returns
 */
async function findLibSSLInLocations(directories: string[]) {
  for (const dir of directories) {
    const libssl = await findLibSSL(dir)
    if (libssl) {
      return libssl
    }
  }
  return undefined
}

/**
 * Looks for libssl in specific directory
 * @param directory
 * @returns
 */
async function findLibSSL(directory: string) {
  try {
    const dirContents = await fs.readdir(directory)
    return dirContents.find((value) => value.startsWith('libssl.so.') && !value.startsWith('libssl.so.0'))
  } catch (_) {
    return undefined
  }
}

/**
 * Get the binary target for the current platform, e.g. `linux-musl-arm64-openssl-3.0.x` for Linux Alpine on arm64.
 */
export async function getBinaryTargetForCurrentPlatform(): Promise<BinaryTarget> {
  const { binaryTarget } = await getPlatformInfoMemoized()
  return binaryTarget
}

export type PlatformInfo = GetOSResult & { binaryTarget: BinaryTarget }

function isPlatformInfoDefined(args: Partial<PlatformInfo>): args is PlatformInfo {
  return args.binaryTarget !== undefined
}

/**
 * Get the binary target and other system information (e.g., the libssl version to look for) for the current platform.
 */
export async function getPlatformInfo(): Promise<PlatformInfo> {
  const { memoized: _, ...rest } = await getPlatformInfoMemoized()
  return rest
}

let memoizedPlatformWithInfo: Partial<PlatformInfo> = {}

export async function getPlatformInfoMemoized(): Promise<PlatformInfo & { memoized: boolean }> {
  if (isPlatformInfoDefined(memoizedPlatformWithInfo)) {
    return Promise.resolve({ ...memoizedPlatformWithInfo, memoized: true })
  }

  const args = await getos()
  const binaryTarget = getBinaryTargetForCurrentPlatformInternal(args)
  memoizedPlatformWithInfo = { ...args, binaryTarget }
  return { ...(memoizedPlatformWithInfo as PlatformInfo), memoized: false }
}

/**
 * This function is only exported for testing purposes.
 */
export function getBinaryTargetForCurrentPlatformInternal(args: GetOSResult): BinaryTarget {
  const { platform, arch, archFromUname, libssl, targetDistro, familyDistro, originalDistro } = args

  if (platform === 'linux' && !['x64', 'arm64'].includes(arch)) {
    warn(
      `Prisma only officially supports Linux on amd64 (x86_64) and arm64 (aarch64) system architectures (detected "${arch}" instead). If you are using your own custom Prisma engines, you can ignore this warning, as long as you've compiled the engines for your system architecture "${archFromUname}".`,
    )
  }

  // sometimes we fail to detect the libssl version to use, so we default to 1.1.x
  const defaultLibssl = '1.1.x' as const
  if (platform === 'linux' && libssl === undefined) {
    /**
     * Ask the user to install libssl manually, and provide some additional instructions based on the detected Linux distro family.
     * TODO: we should also provide a pris.ly link to a documentation page with more details on how to install libssl.
     */
    const additionalMessage = match({ familyDistro })
      .with({ familyDistro: 'debian' }, () => {
        return "Please manually install OpenSSL via `apt-get update -y && apt-get install -y openssl` and try installing Prisma again. If you're running Prisma on Docker, add this command to your Dockerfile, or switch to an image that already has OpenSSL installed."
      })
      .otherwise(() => {
        return 'Please manually install OpenSSL and try installing Prisma again.'
      })

    warn(
      `Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-${defaultLibssl}".
${additionalMessage}`,
    )
  }

  // sometimes we fail to detect the distro in use, so we default to debian
  const defaultDistro = 'debian' as const
  if (platform === 'linux' && targetDistro === undefined) {
    debug(`Distro is "${originalDistro}". Falling back to Prisma engines built for "${defaultDistro}".`)
  }

  // Apple Silicon (M1)
  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64'
  }

  if (platform === 'darwin') {
    return 'darwin'
  }

  if (platform === 'win32') {
    return 'windows'
  }

  if (platform === 'freebsd') {
    return targetDistro as BinaryTarget
  }

  if (platform === 'openbsd') {
    return 'openbsd'
  }

  if (platform === 'netbsd') {
    return 'netbsd'
  }

  if (platform === 'linux' && arch === 'arm64') {
    // 64 bit ARM (musl or glibc)
    const baseName = targetDistro === 'musl' ? 'linux-musl-arm64' : 'linux-arm64'
    return `${baseName}-openssl-${libssl || defaultLibssl}` as BinaryTarget
  }

  if (platform === 'linux' && arch === 'arm') {
    // 32 bit ARM
    return `linux-arm-openssl-${libssl || defaultLibssl}` as BinaryTarget
  }

  if (platform === 'linux' && targetDistro === 'musl') {
    const base = 'linux-musl'
    if (!libssl) {
      return base
    }

    if (isLibssl1x(libssl)) {
      // Alpine 3.16 or below linked with OpenSSL 1.1
      return base
    } else {
      // Alpine 3.17 or above linked with OpenSSL 3.0
      return `${base}-openssl-${libssl}`
    }
  }

  // when the platform is linux
  if (platform === 'linux' && targetDistro && libssl) {
    return `${targetDistro}-openssl-${libssl}` as BinaryTarget
  }

  if (platform !== 'linux') {
    warn(`Prisma detected unknown OS "${platform}" and may not work as expected. Defaulting to "linux".`)
  }

  // if just OpenSSL is known, fallback to debian with a specific libssl version
  if (libssl) {
    return `${defaultDistro}-openssl-${libssl}`
  }

  // if just the targetDistro is known, fallback to latest OpenSSL 1.1
  if (targetDistro) {
    return `${targetDistro}-openssl-${defaultLibssl}` as BinaryTarget
  }

  // use the debian build with OpenSSL 1.1 as a last resort
  // TODO: perhaps we should default to 'debian-openssl-3.0.x'
  return `${defaultDistro}-openssl-${defaultLibssl}`
}

/**
 * Given a promise generator, returns the promise's result.
 * If the promise throws, returns undefined.
 */
async function discardError<T>(runPromise: () => Promise<T>): Promise<T | undefined> {
  try {
    return await runPromise()
  } catch (e) {
    return undefined
  }
}

/**
 * Executes system command and returns its output. If command fails, returns undefined
 */
function getCommandOutput(command: string) {
  return discardError(async () => {
    const result = await exec(command)

    debug(`Command "${command}" successfully returned "${result.stdout}"`)
    return result.stdout
  })
}

/**
 * Returns the architecture of a system from the output of `uname -m` (whose format is different than `process.arch`).
 * This function never throws.
 * TODO: deprecate this function in favor of `os.machine()` once either Node v16.18.0 or v18.9.0 becomes the minimum
 * supported Node.js version for Prisma.
 */
export async function getArchFromUname(): Promise<string | undefined> {
  if (typeof os['machine'] === 'function') {
    return os['machine']()
  }
  const arch = await getCommandOutput('uname -m')
  return arch?.trim()
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
function isLibssl1x(libssl: NonNullable<GetOSResult['libssl']> | string): libssl is '1.0.x' | '1.1.x' {
  return libssl.startsWith('1.')
}
