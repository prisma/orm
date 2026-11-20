import path from 'node:path'

import { defineConfig } from '@prisma/config'

const basePath = process.cwd()

export default defineConfig({
  datasource: {
    url: 'file:dev.db',
  },
  schema: path.join(basePath, 'prisma'),
})
