import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import readline from 'node:readline'
import timers from 'node:timers/promises'

const schemaPath = new URL('prisma/schema.prisma', import.meta.url)
const modelsPath = new URL('generated/models', import.meta.url)

const initialSchema = /* prisma */ `\
generator client {
  provider = "prisma-client"
  output   = "../generated"
}

datasource db {
  provider = "sqlite"
}

model A {
  id Int @id
}
`

const newModel = /* prisma */ `
model B {
  id String @id
}
`

// Enforce the initial schema state. This is necessary for re-running the test
// after the schema has been modified by it.
await fs.writeFile(schemaPath, initialSchema)

const generate = spawn('npx', ['prisma', 'generate', '--watch'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  detached: true,
})

const rl = readline.createInterface({
  input: generate.stdout,
})

const generateEvents = (async function* () {
  for await (const line of rl) {
    console.log('[generator]', line)
    if (line.includes('Generated Prisma Client')) {
      yield
    }
  }
})()

await generateEvents.next()
assert.deepEqual(await fs.readdir(modelsPath), ['A.ts'])

// Wait a little after generating so the change isn't debounced out
await timers.setTimeout(500)
await fs.appendFile(schemaPath, newModel)

// FIXME: for some reason, we regenerate the client multiple times in a quick
// succession after changing the schema, and the first one does not contain the
// new model yet.
await generateEvents.next()
await generateEvents.next()
assert.deepEqual(await fs.readdir(modelsPath), ['A.ts', 'B.ts'])

// Terminate the whole process group (`npx` -> `./node_modules/.bin/prisma`
// shell wrapper -> actual Node.js process). This is similar to what shell does
// when you press Ctrl+C (except it sends SIGINT and not SIGTERM initially).
// Otherwise, on Linux, `generate.kill()` will only terminate the top-level
// process and keep the actual Prisma CLI process running.
process.kill(-generate.pid!, 'SIGTERM')
