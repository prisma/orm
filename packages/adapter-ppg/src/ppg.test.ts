import { describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/ppg', () => ({
  client: vi.fn().mockReturnValue({}),
  builtinParsers: [],
}))

import { PrismaPostgresAdapter } from './ppg'

describe('PrismaPostgresAdapter', () => {
  it('should extract schema from connection string URL when not provided in config', async () => {
    const adapter = new PrismaPostgresAdapter({
      connectionString: 'postgresql://test:test@localhost:5432/test?schema=custom_schema',
    })
    const connection = await adapter.connect()

    expect(connection.getConnectionInfo().schemaName).toBe('custom_schema')
  })

  it('should extract schema from URL instance when not provided in config', async () => {
    const adapter = new PrismaPostgresAdapter({
      connectionString: new URL('postgresql://test:test@localhost:5432/test?schema=url_schema'),
    })
    const connection = await adapter.connect()

    expect(connection.getConnectionInfo().schemaName).toBe('url_schema')
  })

  it('should prefer explicit schema in config over connection string URL', async () => {
    const adapter = new PrismaPostgresAdapter({
      connectionString: 'postgresql://test:test@localhost:5432/test?schema=url_schema',
      schema: 'explicit_schema',
    })
    const connection = await adapter.connect()

    expect(connection.getConnectionInfo().schemaName).toBe('explicit_schema')
  })

  it('should default to public when no schema is present in URL or config', async () => {
    const adapter = new PrismaPostgresAdapter({
      connectionString: 'postgresql://test:test@localhost:5432/test',
    })
    const connection = await adapter.connect()

    expect(connection.getConnectionInfo().schemaName).toBe('public')
  })

  it('should default to public when empty schema parameter is given', async () => {
    const adapter = new PrismaPostgresAdapter({
      connectionString: 'postgresql://test:test@localhost:5432/test?schema=',
    })
    const connection = await adapter.connect()

    expect(connection.getConnectionInfo().schemaName).toBe('public')
  })

  it('should accept non-URL connection string and default to public without error', async () => {
    const adapter = new PrismaPostgresAdapter({
      connectionString: 'host=localhost port=5432 dbname=test user=test',
    })
    const connection = await adapter.connect()

    expect(connection.getConnectionInfo().schemaName).toBe('public')
  })
})
