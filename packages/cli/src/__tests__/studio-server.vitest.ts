import { Server } from 'node:http'

import { getPort } from 'get-port-please'
import { afterEach, expect, test, vi } from 'vitest'

import { startStudioServer, STUDIO_SERVER_HOST, type StudioServer } from '../studio-server'

const activeServers: StudioServer[] = []

afterEach(() => {
  vi.restoreAllMocks()

  while (activeServers.length > 0) {
    activeServers.pop()!.close()
  }
})

test('streams GET response bodies from the Node Studio server', async () => {
  const { port } = await startTestServer(() => new Response('hello from studio', { status: 200 }))

  const response = await fetch(`http://127.0.0.1:${port}/`)

  expect(response.status).toBe(200)
  expect(await response.text()).toBe('hello from studio')
})

test('binds the listener to the IPv4 loopback address', async () => {
  const port = await getPort({ host: STUDIO_SERVER_HOST, random: true })
  const listenSpy = vi.spyOn(Server.prototype, 'listen')

  await new Promise<void>((resolve) => {
    const server = startStudioServer({
      handler: () => new Response('hello from studio', { status: 200 }),
      onListen: resolve,
      port,
    })

    activeServers.push(server)
  })

  expect(listenSpy).toHaveBeenCalledWith(port, STUDIO_SERVER_HOST, expect.any(Function))
})

test('preserves HEAD semantics without dropping GET bodies', async () => {
  const { port } = await startTestServer(() => new Response('hello from studio', { status: 200 }))

  const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' })

  expect(response.status).toBe(200)
  expect(await response.text()).toBe('')
})

test('logs server errors and returns the error message in the response body', async () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = new Error('boom')
  const { port } = await startTestServer(() => {
    throw error
  })

  const response = await fetch(`http://127.0.0.1:${port}/`)

  expect(response.status).toBe(500)
  expect(response.headers.has('access-control-allow-origin')).toBe(false)
  expect(await response.text()).toBe('boom')
  expect(consoleErrorSpy).toHaveBeenCalledWith('[Prisma Studio]', error)
})

test('does not log when the client disconnects before the response is written', async () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let resolveHandlerStarted!: () => void
  let resolveRequestDestroyed!: () => void
  let resolveRequestSettled!: () => void
  let resolveResponse!: () => void
  const handlerStarted = new Promise<void>((resolve) => {
    resolveHandlerStarted = resolve
  })
  const requestDestroyed = new Promise<void>((resolve) => {
    resolveRequestDestroyed = resolve
  })
  const requestSettled = new Promise<void>((resolve) => {
    resolveRequestSettled = resolve
  })
  const responseReady = new Promise<void>((resolve) => {
    resolveResponse = resolve
  })
  const { port } = await startTestServer(async (request) => {
    resolveHandlerStarted()
    request.signal.addEventListener('abort', resolveRequestDestroyed, { once: true })
    await responseReady
    return new Response('late response')
  }, resolveRequestSettled)
  const abortController = new AbortController()
  const responsePromise = fetch(`http://127.0.0.1:${port}/`, {
    signal: abortController.signal,
  }).catch((error: unknown) => error)

  await handlerStarted
  abortController.abort()
  await requestDestroyed
  resolveResponse()

  await expect(responsePromise).resolves.toMatchObject({ name: 'AbortError' })
  await requestSettled
  expect(consoleErrorSpy).not.toHaveBeenCalled()
})

async function startTestServer(
  handler: (request: Request) => Response | Promise<Response>,
  onNodeRequestSettled?: () => void,
): Promise<{ port: number }> {
  const port = await getPort({ host: '127.0.0.1', random: true })

  await new Promise<void>((resolve) => {
    const server = startStudioServer({
      handler,
      onListen: resolve,
      onNodeRequestSettled,
      port,
    })

    activeServers.push(server)
  })

  return { port }
}
