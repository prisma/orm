import { defineConfig } from 'prisma/config'

export default defineConfig({
  engine: 'classic',
  datasource: {
    url: 'file:./dev.db',
  },
})
