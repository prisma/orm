import process from 'node:process'

import { drawBox } from '@prisma/internals'

type MajorMinor = `${number}.${number}`
type MajorMinorPatch = `${MajorMinor}.${number}`

export function main() {
  printMessageAndExitIfUnsupportedNodeVersion(process.versions.node as MajorMinorPatch)
}

function extractSemanticVersionParts(version: MajorMinor | MajorMinorPatch) {
  return version
    .split('.')
    .slice(0, 2) // only major and minor version
    .map((v) => parseInt(v, 10)) as [number, number]
}

/**
 * Given a Node.js version (e.g. `v16.13.0`), prints an error and exits the process
 * if the Node.js version is not supported by Prisma.
 */
export function printMessageAndExitIfUnsupportedNodeVersion(nodeVersion: MajorMinorPatch) {
  const [nodeMajorVersion, nodeMinorVersion] = extractSemanticVersionParts(nodeVersion)

  // Minimum Node.js versions supported by Prisma
  const MIN_NODE_VERSION_MATRIX: Record<number, number> = {
    20: 19,
    22: 12,
    24: 0,
  }

  const minimumSupportedMinor = MIN_NODE_VERSION_MATRIX[nodeMajorVersion]
  const isNodeVersionSupported =
    typeof minimumSupportedMinor !== 'undefined' && nodeMinorVersion >= minimumSupportedMinor

  if (!isNodeVersionSupported) {
    const supportedVersions = Object.entries(MIN_NODE_VERSION_MATRIX)
      .map(([major, minor]) => `${major}.${minor}+`)
      .join(', ')
    const highestSupportedMajor = Math.max(...Object.keys(MIN_NODE_VERSION_MATRIX).map((major) => Number(major)))
    const isNodeVersionTooNew = nodeMajorVersion > highestSupportedMajor

    const messageLines = [
      `Prisma only supports Node.js versions ${supportedVersions}.`,
      isNodeVersionTooNew ? 'Please use a supported Node.js version.' : 'Please upgrade your Node.js version.',
    ]

    const message = drawBox({
      str: messageLines.join('\n'),
      height: messageLines.length,
      width: 48,
      horizontalPadding: 4,
    })

    if (isNodeVersionTooNew) {
      console.warn(message)
    } else {
      console.error(message)
      process.exit(1)
    }
  }
}
