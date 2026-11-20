import events from 'node:events'
import { promisify } from 'node:util'
import { type MessagePort, parentPort } from 'node:worker_threads'

import { serve, type ServerType } from '@hono/node-server'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import type { Server } from '@prisma/query-plan-executor'

context.setGlobalContextManager(new AsyncLocalStorageContextManager())
trace.setGlobalTracerProvider(new BasicTracerProvider())

export interface QpeWorkerStartMessage {
  type: 'start'
  databaseUrl: string
}

export interface QpeWorkerShutdownMessage {
  type: 'shutdown'
}

export type QpeWorkerMessage = QpeWorkerStartMessage | QpeWorkerShutdownMessage

export interface QpeWorkerReadyResponse {
  type: 'ready'
  hostname: string
  port: number
}

export interface QpeWorkerShutdownResponse {
  type: 'shutdown-complete'
}

export interface QpeWorkerErrorResponse {
  type: 'error'
  message: string
}

export type QpeWorkerResponse = QpeWorkerReadyResponse | QpeWorkerShutdownResponse | QpeWorkerErrorResponse

if (!parentPort) {
  throw new Error('This script must be run as a worker thread')
}

parentPort.on('message', (message: QpeWorkerMessage) => void handleMessage(parentPort!, message))

let server: { qpe: Server; net: ServerType } | undefined

async function handleMessage(port: MessagePort, message: QpeWorkerMessage): Promise<void> {
  try {
    let response: QpeWorkerResponse

    switch (message.type) {
      case 'start':
        response = await handleStart(message)
        break

      case 'shutdown':
        response = await handleShutdown()
        break

      default:
        response = {
          type: 'error',
          message: `Unknown message type: ${(message satisfies never as { type: string }).type}`,
        }
        break
    }

    port.postMessage(response)
  } catch (error) {
    port.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies QpeWorkerErrorResponse)
  }
}

async function handleStart(message: QpeWorkerStartMessage): Promise<QpeWorkerReadyResponse> {
  // It should only be imported after initializing OpenTelemetry
  const { Server, parseSize, parseDuration } = await import('@prisma/query-plan-executor')

  const qpe = await Server.create({
    databaseUrl: message.databaseUrl,
    maxResponseSize: parseSize('128 MiB'),
    queryTimeout: parseDuration('PT30S'),
    maxTransactionTimeout: parseDuration('PT1M'),
    maxTransactionWaitTime: parseDuration('PT1M'),
    perRequestLogContext: {
      logFormat: 'text',
      logLevel: 'warn',
    },
  })

  const hostname = '127.0.0.1'

  const net = serve({
    fetch: qpe.fetch,
    hostname,
    port: 0,
  })

  await events.once(net, 'listening')
  const address = net.address()

  if (address === null) {
    throw new Error('query plan executor server did not start')
  }

  if (typeof address === 'string') {
    throw new Error('query plan executor must be listening on TCP and not Unix socket')
  }

  server = { qpe, net }

  return { type: 'ready', hostname, port: address.port }
}

async function handleShutdown(): Promise<QpeWorkerShutdownResponse> {
  if (server) {
    const closeNetServer = promisify(server.net.close.bind(server.net))
    await Promise.all([closeNetServer(), server.qpe.shutdown()])
    server = undefined
  }

  return { type: 'shutdown-complete' }
}
