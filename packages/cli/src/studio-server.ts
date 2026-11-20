import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { runtime } from 'std-env'

/** Must remain the IPv4 loopback host used by Studio's listener and port probing. */
export const STUDIO_SERVER_HOST = '127.0.0.1'

export type StudioRequestHandler = (request: Request) => Promise<Response> | Response

export interface StudioServer {
  close(): void
}

type StartStudioServerOptions = {
  handler: StudioRequestHandler
  onListen(): void
  onNodeRequestSettled?(): void
  port: number
}

export function startStudioServer(options: StartStudioServerOptions): StudioServer {
  switch (runtime) {
    case 'node':
      return startNodeStudioServer(options)
    case 'bun':
      return startBunStudioServer(options)
    case 'deno':
      return startDenoStudioServer(options)
    default:
      throw new Error(`Unsupported runtime for Studio server: "${runtime}"`)
  }
}

function startNodeStudioServer({
  handler,
  onListen,
  onNodeRequestSettled,
  port,
}: StartStudioServerOptions): StudioServer {
  const server = createServer(async (nodeRequest, nodeResponse) => {
    try {
      const request = createNodeRequest(nodeRequest, nodeResponse, port)
      const response = await handler(request)
      await writeNodeResponse(nodeResponse, response, nodeRequest.method)
    } catch (error) {
      if (nodeResponse.destroyed) {
        return
      }

      console.error('[Prisma Studio]', error)

      if (nodeResponse.headersSent || nodeResponse.writableEnded) {
        nodeResponse.destroy()
        return
      }

      nodeResponse.statusCode = 500
      nodeResponse.end(error instanceof Error ? error.message : 'Internal Server Error')
    } finally {
      onNodeRequestSettled?.()
    }
  })

  server.listen(port, STUDIO_SERVER_HOST, onListen)

  return {
    close() {
      server.close()
    },
  }
}

function createNodeRequest(nodeRequest: IncomingMessage, nodeResponse: ServerResponse, port: number): Request {
  const origin = `http://${nodeRequest.headers.host ?? `localhost:${port}`}`
  const url = new URL(nodeRequest.url ?? '/', origin)
  const headers = new Headers()
  const abortController = new AbortController()

  nodeResponse.once('close', () => {
    if (!nodeResponse.writableEnded) {
      abortController.abort()
    }
  })

  for (const [key, value] of Object.entries(nodeRequest.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item)
      }
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }

  const requestInit: RequestInit & { duplex?: 'half' } = {
    headers,
    method: nodeRequest.method,
    signal: abortController.signal,
  }

  if (methodHasRequestBody(nodeRequest.method)) {
    requestInit.body = Readable.toWeb(nodeRequest) as BodyInit
    requestInit.duplex = 'half'
  }

  return new Request(url, requestInit)
}

async function writeNodeResponse(nodeResponse: ServerResponse, response: Response, method: string | undefined) {
  nodeResponse.statusCode = response.status
  nodeResponse.statusMessage = response.statusText

  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value)
  })

  if (isHeadRequest(method) || !response.body) {
    nodeResponse.end()
    return
  }

  await pipeline(Readable.fromWeb(response.body as never), nodeResponse)
}

function startBunStudioServer({ handler, onListen, port }: StartStudioServerOptions): StudioServer {
  const bun = (
    globalThis as typeof globalThis & {
      Bun?: {
        serve(options: { fetch: StudioRequestHandler; hostname: string; port: number }): {
          stop(closeActiveConnections?: boolean): void
        }
      }
    }
  ).Bun

  if (!bun) {
    throw new Error('Bun runtime is not available.')
  }

  const server = bun.serve({
    fetch: handler,
    hostname: STUDIO_SERVER_HOST,
    port,
  })

  onListen()

  return {
    close() {
      server.stop(true)
    },
  }
}

function startDenoStudioServer({ handler, onListen, port }: StartStudioServerOptions): StudioServer {
  const abortController = new AbortController()
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: {
        serve(
          options: { hostname: string; port: number; signal: AbortSignal },
          handler: StudioRequestHandler,
        ): { shutdown?(): Promise<void> }
      }
    }
  ).Deno

  if (!deno) {
    throw new Error('Deno runtime is not available.')
  }

  deno.serve({ hostname: STUDIO_SERVER_HOST, port, signal: abortController.signal }, handler)
  onListen()

  return {
    close() {
      abortController.abort()
    },
  }
}

function isHeadRequest(method: string | undefined): boolean {
  return method === 'HEAD'
}

function methodHasRequestBody(method: string | undefined): boolean {
  return method !== 'GET' && method !== 'HEAD'
}
