import readline from 'node:readline'

import type { GeneratorConfig, GeneratorManifest, GeneratorOptions } from '@prisma/generator'

import * as JsonRpc from './json-rpc'

export interface Handler {
  onGenerate(options: GeneratorOptions): Promise<any>
  onManifest?(config: GeneratorConfig): GeneratorManifest | Promise<GeneratorManifest>
}

export function generatorHandler(handler: Handler): void {
  const stdinInterface = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  stdinInterface.on('line', async (line: string) => {
    const json = JSON.parse(line)

    if (json.method === 'generate' && json.params) {
      try {
        const result = await handler.onGenerate(json.params)
        respond({
          jsonrpc: '2.0',
          result: result,
          id: json.id,
        })
      } catch (_e) {
        const e = _e as Error
        respond({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: e.message,
            data: {
              stack: e.stack,
            },
          },
          id: json.id,
        })
      }
    }

    if (json.method === 'getManifest') {
      if (handler.onManifest) {
        try {
          const manifest = await handler.onManifest(json.params)
          respond({
            jsonrpc: '2.0',
            result: {
              manifest,
            },
            id: json.id,
          })
        } catch (_e) {
          const e = _e as Error
          respond({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: e.message,
              data: {
                stack: e.stack,
              },
            },
            id: json.id,
          })
        }
      } else {
        respond({
          jsonrpc: '2.0',
          result: {
            manifest: null,
          },
          id: json.id,
        })
      }
    }
  })

  process.stdin.resume()
}

function respond(response: JsonRpc.Response): void {
  process.stderr.write(JSON.stringify(response) + '\n')
}
