import { defineConfig } from '@prisma/config'
import { listLocalDatabases } from '@prisma/adapter-d1'

export default defineConfig({
  datasource: {
    url: `file:${listLocalDatabases().pop()}`,
  },
})
