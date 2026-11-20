import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'prisma/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  schema: path.join(__dirname, 'custom-output.prisma'),
  datasource: {
    url: `file:${path.join(__dirname, 'db')}`,
  },
})
