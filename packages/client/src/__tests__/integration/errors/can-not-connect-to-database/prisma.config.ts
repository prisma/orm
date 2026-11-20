import { defineConfig } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: 'postgres://prisma:prisma@localhost:5444/tests)',
  },
})
