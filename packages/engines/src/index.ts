import { Debug } from '@prisma/debug'
import { enginesVersion } from '@prisma/engines-version'
import type { BinaryPaths, DownloadOptions } from '@prisma/fetch-engine'
import { BinaryType } from '@prisma/fetch-engine'
import type { BinaryTarget } from '@prisma/get-platform'
import path from 'path'

const debug = Debug('prisma:engines')
export function getEnginesPath() {
  return path.join(__dirname, '../')
}

type EnsureSomeBinariesExistInput = {
  download: (options: DownloadOptions) => Promise<BinaryPaths>
}

export async function ensureNeededBinariesExist({ download }: EnsureSomeBinariesExistInput) {
  const binaryDir = path.join(__dirname, '../')

  const binaries = {
    [BinaryType.SchemaEngineBinary]: binaryDir,
  } satisfies Record<BinaryType, string>

  debug(`binaries to download ${Object.keys(binaries).join(', ')}`)

  const binaryTargets = process.env.PRISMA_CLI_BINARY_TARGETS
    ? (process.env.PRISMA_CLI_BINARY_TARGETS.split(',') as BinaryTarget[])
    : undefined

  await download({
    binaries: binaries,
    showProgress: true,
    version: enginesVersion,
    failSilent: false,
    binaryTargets,
  })
}

export { enginesVersion } from '@prisma/engines-version'
