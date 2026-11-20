import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, env } from 'prisma/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  schema: path.join(__dirname, 'schema.prisma'),
  datasource: {
    url: env('POSTGRES_URL'),
  },
})
