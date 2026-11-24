import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils'
import { EventEmitter } from 'events'

import { disabledTracingHelper } from '../../tracing/TracingHelper'
import type { AccelerateExtensionFetch } from '../common/Engine'
import type { LogEmitter, LogEvent } from '../common/types/Events'
import { RemoteExecutor } from './RemoteExecutor'

const ACCELERATE_URL = 'prisma://accelerate.prisma-data.net/?api_key=test-api-key'

const connectionInfo = { provider: 'postgres', connectionInfo: { supportsRelationJoins: true } }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function networkError(): TypeError {
  return new TypeError('fetch failed', { cause: new Error('other side closed') })
}

function setup(responses: Array<Response | Error>) {
  const warnings: string[] = []
  const logEmitter = new EventEmitter() as unknown as LogEmitter
  logEmitter.on('warn', (event: LogEvent) => warnings.push(event.message))

  const executor = new RemoteExecutor({
    clientVersion: '0.0.0',
    accelerateUrl: ACCELERATE_URL,
    logEmitter,
    logLevel: 'info',
    logQueries: false,
    tracingHelper: disabledTracingHelper,
  })

  const fetch = jest.fn<ReturnType<AccelerateExtensionFetch>, Parameters<AccelerateExtensionFetch>>(() => {
    const next = responses.shift()
    if (next === undefined) {
      throw new Error('unexpected request')
    }
    return next instanceof Response ? Promise.resolve(next) : Promise.reject(next)
  })

  return { executor, fetch, warnings }
}

function execute(executor: RemoteExecutor, fetch: AccelerateExtensionFetch) {
  return executor.execute({
    plan: { type: 'value', args: 1 } as never,
    placeholderValues: {},
    model: 'User',
    operation: 'findMany',
    transaction: undefined,
    batchIndex: undefined,
    customFetch: fetch,
    queryInfo: { type: 'single', modelName: 'User', action: 'findMany', query: {} },
  })
}

describe('RemoteExecutor retries', () => {
  let globalFetch: jest.SpyInstance

  beforeEach(() => {
    globalFetch = jest.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    globalFetch.mockRestore()
  })

  test('retries a request whose fetch rejects with a network error', async () => {
    const { executor, fetch, warnings } = setup([networkError(), networkError(), jsonResponse({ data: [] })])

    await expect(execute(executor, fetch)).resolves.toEqual([])

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(warnings).toEqual([
      'Attempt 1/3 failed for POST /query: fetch failed',
      expect.stringMatching(/^Retrying after \d+ms$/),
      'Attempt 2/3 failed for POST /query: fetch failed',
      expect.stringMatching(/^Retrying after \d+ms$/),
    ])
  })

  test('sends the same request again on retry', async () => {
    const { executor, fetch } = setup([networkError(), jsonResponse({ data: [] })])

    await execute(executor, fetch)

    const [first, second] = fetch.mock.calls
    expect(second[0]).toEqual(first[0])
    expect(second[1].method).toEqual(first[1].method)
    expect(second[1].body).toEqual(first[1].body)
  })

  test.each([500, 502, 503])('retries a %d response', async (status) => {
    const { executor, fetch, warnings } = setup([
      jsonResponse({ message: 'Worker exceeded resource limits' }, status),
      jsonResponse({ data: [] }),
    ])

    await expect(execute(executor, fetch)).resolves.toEqual([])

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(warnings[0]).toEqual(`Attempt 1/3 failed for POST /query: HTTP ${status}`)
  })

  test('does not put the response body of a retried request in the logs', async () => {
    const { executor, fetch, warnings } = setup([
      new Response(JSON.stringify({ message: 'internal details: secret-value' }), {
        status: 503,
        statusText: 'Service Unavailable',
      }),
      jsonResponse({ data: [] }),
    ])

    await expect(execute(executor, fetch)).resolves.toEqual([])

    expect(warnings[0]).toEqual('Attempt 1/3 failed for POST /query: HTTP 503 Service Unavailable')
    expect(warnings.join('\n')).not.toContain('secret-value')
  })

  test.each([
    ['AbortError', 'This operation was aborted'],
    ['TimeoutError', 'The operation was aborted due to timeout'],
  ])('does not retry a request cancelled with %s', async (name, message) => {
    const error = new DOMException(message, name)
    const { executor, fetch, warnings } = setup([error, jsonResponse({ data: [] })])

    await expect(execute(executor, fetch)).rejects.toBe(error)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(warnings).toEqual([])
  })

  test('retries requests that use the global fetch', async () => {
    const { executor } = setup([])
    globalFetch.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(jsonResponse(connectionInfo))

    await expect(executor.getConnectionInfo()).resolves.toEqual(connectionInfo)
    expect(globalFetch).toHaveBeenCalledTimes(2)
  })

  test('rethrows the network error after the last retry', async () => {
    const error = networkError()
    const { executor, fetch, warnings } = setup([error, error, error, error])

    await expect(execute(executor, fetch)).rejects.toBe(error)

    expect(fetch).toHaveBeenCalledTimes(4)
    expect(warnings.filter((message) => message.startsWith('Attempt'))).toHaveLength(3)
  })

  test('reports the last server error after the last retry', async () => {
    const { executor, fetch } = setup([
      jsonResponse({ message: 'first' }, 503),
      jsonResponse({ message: 'second' }, 503),
      jsonResponse({ message: 'third' }, 503),
      jsonResponse({ message: 'last' }, 503),
    ])

    const result = execute(executor, fetch)

    await expect(result).rejects.toBeInstanceOf(PrismaClientKnownRequestError)
    await expect(result).rejects.toMatchObject({ message: 'last', code: 'P6000' })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  test.each([
    [400, { code: 'P2002', error: 'Unique constraint failed on the fields: (`email`)' }],
    [409, { code: 'P2028', error: 'Transaction already closed' }],
    [422, { error: 'Query exceeded the response size limit' }],
    [504, { message: 'Query timed out' }],
  ])('does not retry a %d response', async (status, body) => {
    const { executor, fetch, warnings } = setup([jsonResponse(body, status)])

    await expect(execute(executor, fetch)).rejects.toBeInstanceOf(PrismaClientKnownRequestError)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(warnings).toEqual([])
  })
})
