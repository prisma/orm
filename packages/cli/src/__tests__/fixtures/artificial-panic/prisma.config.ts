import { defineConfig } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: 'postgres://user:password@randomhost:5432',
  },
})
