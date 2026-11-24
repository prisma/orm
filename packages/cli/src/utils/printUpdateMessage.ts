import { drawBox, isCurrentBinInstalledGlobally } from '@prisma/internals'
import type { Check } from 'checkpoint-client'
import { blue, bold } from 'kleur/colors'

const isPrismaInstalledGlobally = isCurrentBinInstalledGlobally()

export function printUpdateMessage(checkResult: Check.Result | 0 | void): void {
  const shouldHide = process.env.PRISMA_HIDE_UPDATE_MESSAGE
  if (!checkResult || checkResult.status !== 'ok' || shouldHide || !checkResult.data.outdated) {
    return
  }

  const currentVersionInstalled = checkResult.data.previous_version
  const latestVersionAvailable = checkResult.data.current_version
  const updateLine = `${blue('Update available')} ${currentVersionInstalled} -> ${latestVersionAvailable}`

  const majorInstalled = Number(currentVersionInstalled.split('.')[0])
  const majorAvailable = Number(latestVersionAvailable.split('.')[0])
  const isMajorUpdate = majorInstalled < majorAvailable

  let boxText: string
  if (isMajorUpdate) {
    // Every major version has its own upgrade guide, so the link names the major being upgraded to.
    // A single link for all majors can only point at one guide, and goes stale with the next major.
    const upgradeGuideUrl = `https://www.prisma.io/docs/guides/upgrade-prisma-orm/v${majorAvailable}`
    boxText = `\n${updateLine}\n\nThis is a major update - please follow the guide at\n${upgradeGuideUrl}`
  } else {
    const prismaCLICommand = makeInstallCommand(checkResult.data.package, checkResult.data.release_tag)
    const prismaClientCommand = makeInstallCommand('@prisma/client', checkResult.data.release_tag, {
      canBeGlobal: false,
      canBeDev: false,
    })
    boxText = `\n${updateLine}\nRun the following to update
  ${bold(prismaCLICommand)}
  ${bold(prismaClientCommand)}`
  }

  const boxedMessage = drawBox({
    height: 4,
    width: 59,
    str: boxText,
    horizontalPadding: 2,
  })

  console.error(boxedMessage)
}

function makeInstallCommand(
  packageName: string,
  tag: string,
  options = {
    canBeGlobal: true,
    canBeDev: true,
  },
): string {
  let command = ''
  if (isPrismaInstalledGlobally === 'npm' && options.canBeGlobal) {
    command = `npm i -g ${packageName}`
  } else if (options.canBeDev) {
    command = `npm i --save-dev ${packageName}`
  } else {
    command = `npm i ${packageName}`
  }

  // always output tag (so major upgrades work)
  // see https://www.npmjs.com/package/prisma?activeTab=versions
  // (can only be latest or dev via checkpoint-server)
  command += `@${tag}`

  return command
}
