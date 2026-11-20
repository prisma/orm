import { ServerState } from '@prisma/dev/internal/state'

/**
 * Collects information about whether the given url connects to a Prisma Postgres remote or local database.
 * Mimicking parts of the tracking logic in the Prisma VSCode extension.
 */
export async function getPpgInfo(connectionString: string) {
  const url = new URL(connectionString)
  const isLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname === '[0:0:0:0:0:0:0:1]'

  let type: 'remote' | 'local' | undefined
  if (url.protocol === 'prisma+postgres:' && url.hostname === 'accelerate.prisma-data.net') {
    type = 'remote'
  } else if ((url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname === 'db.prisma.io') {
    type = 'remote'
  } else if (url.protocol === 'prisma+postgres:' && isLocalhost) {
    type = 'local'
  } else if ((url.protocol === 'postgres:' || url.protocol === 'postgresql:') && isLocalhost) {
    const servers = await ServerState.scan()
    for (const server of servers) {
      if (
        server.status === 'running' &&
        [server.databasePort, server.shadowDatabasePort].includes(parseInt(url.port ?? ''))
      ) {
        type = 'local'
      }
    }
  }

  return type ? { ppg: { type } } : {}
}
