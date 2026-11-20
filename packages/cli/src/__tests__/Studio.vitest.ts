import { defaultTestConfig } from '@prisma/config'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const createPoolMock = vi.fn(() => ({ end: vi.fn() }))
const getPortMock = vi.fn(() => Promise.resolve(55_555))
const readFileMock = vi.fn((filePath: string) => {
  if (/[\\/]studio\.js$/.test(filePath)) {
    return Promise.resolve('window.__studioBundle = true;')
  }

  if (/[\\/]studio\.css$/.test(filePath)) {
    return Promise.resolve('.ps { color: black; }')
  }

  const error = new Error(`File not found: ${filePath}`) as Error & { code?: string }
  error.code = 'ENOENT'
  return Promise.reject(error)
})
const startStudioServerMock = vi.fn(() => ({ close: vi.fn() }))
const createPostgresJSExecutorMock = vi.fn(() => ({
  execute: vi.fn(),
}))
const serializeErrorMock = vi.fn((error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: JSON.stringify(error),
    name: 'UnknownError',
  }
})

vi.mock('mysql2/promise', () => {
  return {
    createPool: createPoolMock,
  }
})

vi.mock('get-port-please', () => {
  return {
    getPort: getPortMock,
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()

  return {
    ...actual,
    readFile: readFileMock,
  }
})

vi.mock('../studio-server', () => {
  return {
    STUDIO_SERVER_HOST: '127.0.0.1',
    startStudioServer: startStudioServerMock,
  }
})

vi.mock('@prisma/studio-core/data/mysql2', () => {
  return {
    createMySQL2Executor: vi.fn(() => ({
      execute: vi.fn(),
    })),
  }
})

vi.mock('@prisma/studio-core/data/bff', () => {
  return {
    serializeError: serializeErrorMock,
  }
})

vi.mock('@prisma/studio-core/data/node-sqlite', () => {
  return {
    createNodeSQLiteExecutor: vi.fn(() => ({
      execute: vi.fn(),
    })),
  }
})

vi.mock('@prisma/studio-core/data/postgresjs', () => {
  return {
    createPostgresJSExecutor: createPostgresJSExecutorMock,
  }
})

beforeEach(() => {
  getPortMock.mockReset()
  getPortMock.mockResolvedValue(55_555)
})

test('uses the Prisma 7 config filename in help examples', async () => {
  const { Studio } = await import('../Studio')
  const help = Studio.new('prisma').help()

  expect(help).toEqual(expect.any(String))
  expect(help).toContain('studio --config=./prisma7.config.ts')
  expect(help).not.toContain('studio --config=./prisma.config.ts')
})

describe('Studio URL validation', () => {
  beforeEach(() => {
    vi.resetModules()
    createPoolMock.mockClear()
    createPostgresJSExecutorMock.mockClear()
    readFileMock.mockClear()
    startStudioServerMock.mockClear()
    serializeErrorMock.mockClear()
  })

  test('accepts sqlserver:// URLs (semicolon-delimited, not valid WHATWG URLs)', async () => {
    const { Studio } = await import('../Studio')

    const result = await Studio.new('prisma').parse(
      ['--browser', 'none', '--port', '5555', '--url', 'sqlserver://localhost;database=mydb;user=sa;password=secret'],
      defaultTestConfig(),
    )

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).name).toBe('UserFacingError')
    expect((result as Error).message).toContain('Prisma Studio is not supported for the "sqlserver" protocol.')
  })

  test('rejects invalid non-sqlserver URLs', async () => {
    const { Studio } = await import('../Studio')

    const result = await Studio.new('prisma').parse(
      ['--browser', 'none', '--port', '5555', '--url', 'not a valid url'],
      defaultTestConfig(),
    )

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).name).toBe('UserFacingError')
    expect((result as Error).message).toContain('The provided database URL is not valid.')
  })

  test('passes valid mysql:// URLs through unchanged', async () => {
    const { Studio } = await import('../Studio')

    const result = await Studio.new('prisma').parse(
      ['--browser', 'none', '--port', '5555', '--url', 'mysql://user:password@aws.connect.psdb.cloud/db'],
      defaultTestConfig(),
    )

    expect(result).toBe('')
    expect(createPoolMock).toHaveBeenCalledTimes(1)
    // Verify the URL was forwarded to the mysql2 pool, preserving
    // the protocol, host, and path. We compare URL components rather
    // than raw strings because normaliseMySQLConnectionString may
    // round-trip the connection URL through new URL().
    expect(new URL(createPoolMock.mock.calls[0][0]).protocol).toBe('mysql:')
    expect(new URL(createPoolMock.mock.calls[0][0]).hostname).toBe('aws.connect.psdb.cloud')
    expect(new URL(createPoolMock.mock.calls[0][0]).pathname).toBe('/db')
  })
})

describe('Studio port selection', () => {
  beforeEach(() => {
    vi.resetModules()
    createPostgresJSExecutorMock.mockClear()
    startStudioServerMock.mockClear()
  })

  test('checks for an available port on the loopback interface when no port is requested', async () => {
    const { Studio } = await import('../Studio')

    await Studio.new('prisma').parse(
      ['--browser', 'none', '--url', 'postgresql://user:password@localhost:5432/db'],
      defaultTestConfig(),
    )

    expect(getPortMock).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 51_212,
      portRange: [49_152, 51_211],
    })
    expect(startStudioServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 55_555 }))
  })

  test('uses a requested port without probing for an available port', async () => {
    const { Studio } = await import('../Studio')

    await Studio.new('prisma').parse(
      ['--browser', 'none', '--port', '5555', '--url', 'postgresql://user:password@localhost:5432/db'],
      defaultTestConfig(),
    )

    expect(getPortMock).not.toHaveBeenCalled()
    expect(startStudioServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 5_555 }))
  })

  test.each(['0', '-1', '1.5', '65536'])(
    'rejects an explicitly requested port outside the valid integer range: %s',
    async (port) => {
      const { Studio } = await import('../Studio')

      const result = await Studio.new('prisma').parse(
        ['--browser', 'none', '--port', port, '--url', 'postgresql://user:password@localhost:5432/db'],
        defaultTestConfig(),
      )

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).name).toBe('UserFacingError')
      expect((result as Error).message).toContain('The Studio port must be an integer between 1 and 65535.')
      expect(getPortMock).not.toHaveBeenCalled()
      expect(startStudioServerMock).not.toHaveBeenCalled()
    },
  )
})

describe('Studio MySQL URL compatibility', () => {
  beforeEach(() => {
    vi.resetModules()
    createPoolMock.mockClear()
    createPostgresJSExecutorMock.mockClear()
    readFileMock.mockClear()
    startStudioServerMock.mockClear()
    serializeErrorMock.mockClear()
  })

  test('converts sslaccept=strict to mysql2 ssl JSON', async () => {
    const { Studio } = await import('../Studio')

    await Studio.new('prisma').parse(
      [
        '--browser',
        'none',
        '--port',
        '5555',
        '--url',
        'mysql://user:password@aws.connect.psdb.cloud/db?sslaccept=strict',
      ],
      defaultTestConfig(),
    )

    expect(createPoolMock).toHaveBeenCalledTimes(1)

    const passedUrl = new URL(createPoolMock.mock.calls[0][0])

    expect(passedUrl.searchParams.get('sslaccept')).toBeNull()
    expect(passedUrl.searchParams.get('ssl')).toBe('{"rejectUnauthorized":true}')
  })

  test('maps connection_limit to mysql2 connectionLimit', async () => {
    const { Studio } = await import('../Studio')

    await Studio.new('prisma').parse(
      [
        '--browser',
        'none',
        '--port',
        '5555',
        '--url',
        'mysql://user:password@aws.connect.psdb.cloud/db?connection_limit=7',
      ],
      defaultTestConfig(),
    )

    expect(createPoolMock).toHaveBeenCalledTimes(1)

    const passedUrl = new URL(createPoolMock.mock.calls[0][0])

    expect(passedUrl.searchParams.get('connection_limit')).toBeNull()
    expect(passedUrl.searchParams.get('connectionLimit')).toBe('7')
  })

  test('converts sslaccept=accept_invalid_certs to mysql2 ssl JSON', async () => {
    const { Studio } = await import('../Studio')

    await Studio.new('prisma').parse(
      [
        '--browser',
        'none',
        '--port',
        '5555',
        '--url',
        'mysql://user:password@aws.connect.psdb.cloud/db?sslaccept=accept_invalid_certs',
      ],
      defaultTestConfig(),
    )

    expect(createPoolMock).toHaveBeenCalledTimes(1)

    const passedUrl = new URL(createPoolMock.mock.calls[0][0])

    expect(passedUrl.searchParams.get('sslaccept')).toBeNull()
    expect(passedUrl.searchParams.get('ssl')).toBe('{"rejectUnauthorized":false}')
  })
})

describe('Studio BFF', () => {
  beforeEach(() => {
    vi.resetModules()
    createPoolMock.mockClear()
    createPostgresJSExecutorMock.mockClear()
    readFileMock.mockClear()
    startStudioServerMock.mockClear()
    serializeErrorMock.mockClear()
  })

  test('routes sql-lint requests to executor.lintSql', async () => {
    const lintSqlMock = vi.fn(() =>
      Promise.resolve([
        null,
        {
          diagnostics: [{ from: 0, message: 'lint-ok', severity: 'info', to: 1 }],
          schemaVersion: 'v1',
        },
      ]),
    )

    await startStudioBff({
      execute: vi.fn(),
      lintSql: lintSqlMock,
    })

    const response = await getBffResponse({
      procedure: 'sql-lint',
      schemaVersion: 'v1',
      sql: 'select 1',
    })

    expect(lintSqlMock).toHaveBeenCalledWith({
      schemaVersion: 'v1',
      sql: 'select 1',
    })
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(await response.json()).toEqual([
      null,
      {
        diagnostics: [{ from: 0, message: 'lint-ok', severity: 'info', to: 1 }],
        schemaVersion: 'v1',
      },
    ])
  })

  test('unwraps RPC-serialized sql-lint errors', async () => {
    await startStudioBff({
      execute: vi.fn(),
      lintSql: vi.fn(() =>
        Promise.resolve([
          {
            '@@error': {
              message: 'relation "missing_table" does not exist',
              name: 'PostgresError',
            },
          },
        ]),
      ),
    })

    const response = await getBffResponse({
      procedure: 'sql-lint',
      schemaVersion: 'v1',
      sql: 'select * from missing_table',
    })

    expect(serializeErrorMock).not.toHaveBeenCalled()
    expect(await response.json()).toEqual([
      {
        message: 'relation "missing_table" does not exist',
        name: 'PostgresError',
      },
    ])
  })

  test('passes through top-level serialized sql-lint errors', async () => {
    await startStudioBff({
      execute: vi.fn(),
      lintSql: vi.fn(() =>
        Promise.resolve([
          {
            message: 'syntax error at or near "from"',
            name: 'PostgresError',
          },
        ]),
      ),
    })

    const response = await getBffResponse({
      procedure: 'sql-lint',
      schemaVersion: 'v1',
      sql: 'select from',
    })

    expect(serializeErrorMock).not.toHaveBeenCalled()
    expect(await response.json()).toEqual([
      {
        message: 'syntax error at or near "from"',
        name: 'PostgresError',
      },
    ])
  })

  test('unwraps nested serialized sql-lint errors', async () => {
    await startStudioBff({
      execute: vi.fn(),
      lintSql: vi.fn(() =>
        Promise.resolve([
          {
            error: {
              message: 'relation "users" does not exist',
              name: 'PostgresError',
            },
          },
        ]),
      ),
    })

    const response = await getBffResponse({
      procedure: 'sql-lint',
      schemaVersion: 'v1',
      sql: 'select * from users',
    })

    expect(serializeErrorMock).not.toHaveBeenCalled()
    expect(await response.json()).toEqual([
      {
        message: 'relation "users" does not exist',
        name: 'PostgresError',
      },
    ])
  })

  test('falls back to serializeError for unknown sql-lint error shapes', async () => {
    await startStudioBff({
      execute: vi.fn(),
      lintSql: vi.fn(() =>
        Promise.resolve([
          {
            message: 'missing name field',
          } as never,
        ]),
      ),
    })

    const response = await getBffResponse({
      procedure: 'sql-lint',
      schemaVersion: 'v1',
      sql: 'select 1',
    })

    expect(serializeErrorMock).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual([
      {
        message: '{"message":"missing name field"}',
        name: 'UnknownError',
      },
    ])
  })

  test('routes transaction requests to executor.executeTransaction', async () => {
    const executeTransactionMock = vi.fn(() => Promise.resolve([null, [[{ id: 1 }], [{ id: 2 }]]]))

    const queries = [
      { parameters: [], sql: 'select 1 as id' },
      { parameters: [], sql: 'select 2 as id' },
    ]

    await startStudioBff({
      execute: vi.fn(),
      executeTransaction: executeTransactionMock,
    })

    const response = await getBffResponse({
      procedure: 'transaction',
      queries,
    })

    expect(executeTransactionMock).toHaveBeenCalledWith(queries)
    expect(await response.json()).toEqual([null, [[{ id: 1 }], [{ id: 2 }]]])
  })

  test('rejects cross-origin BFF requests before executing a query', async () => {
    const executeMock = vi.fn()

    await startStudioBff({
      execute: executeMock,
    })

    const response = await getServerResponse('http://localhost:5555/bff', {
      body: JSON.stringify({
        procedure: 'query',
        query: { parameters: [], sql: 'delete from User' },
      }),
      headers: {
        'content-type': 'text/plain',
        origin: 'https://attacker.example',
      },
      method: 'POST',
    })

    expect(response.status).toBe(403)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(executeMock).not.toHaveBeenCalled()
  })

  test('allows same-origin BFF requests', async () => {
    const executeMock = vi.fn(() => Promise.resolve([null, [{ id: 1 }]]))

    await startStudioBff({
      execute: executeMock,
    })

    const response = await getServerResponse('http://localhost:5555/bff', {
      body: JSON.stringify({
        procedure: 'query',
        query: { parameters: [], sql: 'select 1 as id' },
      }),
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:5555',
      },
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(executeMock).toHaveBeenCalledWith({ parameters: [], sql: 'select 1 as id' })
  })

  test.each(['http://localhost', 'http://127.0.0.1'])('allows default-port BFF requests from %s', async (origin) => {
    const executeMock = vi.fn(() => Promise.resolve([null, [{ id: 1 }]]))

    await startStudioBff(
      {
        execute: executeMock,
      },
      80,
    )

    const response = await getServerResponse(`${origin}/bff`, {
      body: JSON.stringify({
        procedure: 'query',
        query: { parameters: [], sql: 'select 1 as id' },
      }),
      headers: {
        'content-type': 'application/json',
        origin,
      },
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(executeMock).toHaveBeenCalledWith({ parameters: [], sql: 'select 1 as id' })
  })

  test.each(['http://localhost', 'http://127.0.0.1'])(
    'allows default-port telemetry requests from %s',
    async (origin) => {
      await startStudioBff(
        {
          execute: vi.fn(),
        },
        80,
      )

      const response = await getServerResponse(`${origin}/telemetry`, {
        body: JSON.stringify({
          eventId: 'event-id',
          name: 'studio_closed',
          payload: {},
          timestamp: '2026-08-05T00:00:00.000Z',
        }),
        headers: {
          'content-type': 'application/json',
          origin,
        },
        method: 'POST',
      })

      expect(response.status).toBe(200)
    },
  )

  test('returns an explicit error when query insights are unsupported', async () => {
    await startStudioBff({
      execute: vi.fn(),
    })

    const response = await getBffResponse({
      procedure: 'query-insights',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        message: 'Executor does not support query insights',
        name: 'Error',
      },
    ])
  })

  test('serves the Prisma logo as the favicon', async () => {
    await startStudioBff({
      execute: vi.fn(),
    })

    const response = await getServerResponse('http://localhost:5555/favicon.ico')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(await response.text()).toContain('<svg')
  })

  test('serves the bundled Studio HTML shell without CDN dependencies', async () => {
    await startStudioBff({
      execute: vi.fn(),
    })

    const response = await getServerResponse('http://localhost:5555/')
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(html).toContain('<link rel="icon"')
    expect(html).toContain('<link rel="stylesheet" href="/studio.css">')
    expect(html).toContain('<script type="module" src="/studio.js"></script>')
    expect(html).toContain('window.__STUDIO_CONFIG__ = {"adapter":"postgres"};')
    expect(html).not.toContain('importmap')
    expect(html).not.toContain('esm.sh')
    expect(html).not.toContain('cdn.jsdelivr.net')
    expect(html).not.toContain('/adapter.js')
  })

  test('serves the bundled Studio JavaScript and CSS assets', async () => {
    await startStudioBff({
      execute: vi.fn(),
    })

    const [jsResponse, cssResponse] = await Promise.all([
      getServerResponse('http://localhost:5555/studio.js'),
      getServerResponse('http://localhost:5555/studio.css'),
    ])

    expect(jsResponse.status).toBe(200)
    expect(jsResponse.headers.get('content-type')).toBe('application/javascript')
    expect(await jsResponse.text()).toBe('window.__studioBundle = true;')

    expect(cssResponse.status).toBe(200)
    expect(cssResponse.headers.get('content-type')).toBe('text/css')
    expect(await cssResponse.text()).toBe('.ps { color: black; }')
  })

  test('rejects cross-origin preflight requests', async () => {
    await startStudioBff({
      execute: vi.fn(),
    })

    const response = await getServerResponse('http://localhost:5555/bff', {
      headers: {
        'access-control-request-method': 'POST',
        origin: 'https://attacker.example',
      },
      method: 'OPTIONS',
    })

    expect(response.status).toBe(403)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
  })

  test('no longer serves adapter.js', async () => {
    await startStudioBff({
      execute: vi.fn(),
    })

    const response = await getServerResponse('http://localhost:5555/adapter.js')

    expect(response.status).toBe(404)
  })
})

async function getBffResponse(body: unknown): Promise<Response> {
  return getServerResponse('http://localhost:5555/bff', {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
}

async function getServerResponse(input: string, init?: RequestInit): Promise<Response> {
  const fetchHandler = startStudioServerMock.mock.calls.at(-1)?.[0]?.handler as
    | ((request: Request) => Promise<Response>)
    | undefined

  if (!fetchHandler) {
    throw new Error('Studio server fetch handler was not registered')
  }

  return fetchHandler(new Request(input, init))
}

async function startStudioBff(
  executor: {
    execute: ReturnType<typeof vi.fn>
    executeTransaction?: ReturnType<typeof vi.fn>
    lintSql?: ReturnType<typeof vi.fn>
  },
  port = 5555,
) {
  createPostgresJSExecutorMock.mockReturnValueOnce(executor)

  const { Studio } = await import('../Studio')

  await Studio.new('prisma').parse(
    ['--browser', 'none', '--port', String(port), '--url', 'postgresql://user:password@localhost:5432/db'],
    defaultTestConfig(),
  )
}
