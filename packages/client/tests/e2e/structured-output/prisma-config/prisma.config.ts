import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: 'file:./db',
  },
  schema: './prisma/schema.prisma',
})
