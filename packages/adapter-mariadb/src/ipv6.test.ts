import net from 'node:net'

import * as mariadb from 'mariadb'
import { describe, expect, test } from 'vitest'

import { PrismaMariaDbAdapterFactory, rewriteConnectionString } from './mariadb'

describe('IPv6 connection strings', () => {
  test('are accepted by the driver', () => {
    const connectionString = 'mariadb://user:pass@[2001:db8::1]:3306/db'

    // `createPool` does not connect, but it does parse the connection string eagerly, so it
    // throws on a host the driver's grammar rejects.
    const pool = mariadb.createPool(rewriteConnectionString(new URL(connectionString)).toString())
    void pool.end()
  })

  test('reach a server listening on ::1', async () => {
    const server = net.createServer()

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '::1', resolve)
      })
    } catch (error) {
      server.close()
      // Environments without an IPv6 loopback have nothing meaningful to assert here.
      if ((error as NodeJS.ErrnoException).code === 'EADDRNOTAVAIL') return
      throw error
    }

    const remoteAddress = new Promise<string | undefined>((resolve) => {
      server.once('connection', (socket) => {
        resolve(socket.remoteAddress)
        socket.destroy()
      })
    })

    const { port } = server.address() as net.AddressInfo
    const factory = new PrismaMariaDbAdapterFactory(
      `mariadb://user:pass@[::1]:${port}/db?connectTimeout=500&initializationTimeout=500&acquireTimeout=500`,
    )

    // The listener is not a MariaDB server, so the handshake never completes. That the driver
    // reaches it over IPv6 at all is what this asserts.
    const connecting = factory.connect()

    // `connect()` swallows connection failures in its capabilities probe, so it rejects only
    // when the driver refused the connection string outright, and resolves without the server
    // ever seeing a socket if it dialled somewhere else. Racing both against the socket reports
    // whichever happened instead of waiting for a connection that is never coming and failing
    // with a bare timeout.
    const connectedElsewhere = connecting.then(
      () => 'connect() finished without the server seeing a connection',
      (error: unknown) => Promise.reject(error),
    )

    try {
      await expect(Promise.race([remoteAddress, connectedElsewhere])).resolves.toBe('::1')
    } finally {
      server.close()
      await connecting.then(
        (adapter) => adapter.dispose().catch(() => {}),
        () => undefined,
      )
    }
  })
})
