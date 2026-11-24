// A minimal third-party generator, equivalent to
// https://github.com/prisma/minimal-generator.
//
// It speaks the JSON-RPC generator protocol directly instead of using
// `@prisma/generator-helper`, because the test copies this fixture into a
// temporary directory where only `@prisma/client` and `@prisma/config` are
// resolvable.

const readline = require('node:readline')

const handlers = {
  getManifest: () => ({
    manifest: {
      defaultOutput: 'default-output',
      prettyName: 'I am a minimal generator',
      requiresEngines: [],
    },
  }),

  generate: () => {
    console.log('minimal generator: generate')
    return null
  },
}

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const request = JSON.parse(line)
  const handler = handlers[request.method]

  const response = handler
    ? { jsonrpc: '2.0', result: handler(request.params), id: request.id }
    : { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${request.method}` }, id: request.id }

  process.stderr.write(JSON.stringify(response) + '\n')
})

process.stdin.resume()
