import path from 'node:path'

import { defineConfig } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: 'file:dev.db',
  },
  schema: path.join(__dirname, 'prisma', 'schema'),
})
