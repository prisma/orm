import path from 'node:path'

export type CliDistributionIdentity = 'prisma' | 'prisma7'
export type CliDistributionPackageName = 'prisma' | '@prisma/prisma7'

/** Returns the CLI distribution selected by the executable that Node invoked. */
export function getCliDistributionIdentity(executedScript = process.argv[1]): CliDistributionIdentity {
  const normalizedScript = executedScript?.replaceAll('\\', '/')
  const stem = normalizedScript === undefined ? undefined : path.posix.parse(normalizedScript).name

  return stem === 'prisma7' ? 'prisma7' : 'prisma'
}

export function getCliDistributionPackageName(identity: CliDistributionIdentity): CliDistributionPackageName {
  return identity === 'prisma7' ? '@prisma/prisma7' : 'prisma'
}

export function getCliDistributionConfigPackageName(
  identity: CliDistributionIdentity,
): `${CliDistributionPackageName}/config` {
  return `${getCliDistributionPackageName(identity)}/config`
}
