import { defineConfig } from '@prisma/config'
export default defineConfig({
  datasource: {
    url: 'file:./dev.db',
  },
  earlyAccess: true,
  migrations: {
    seed: 'node prisma/seed.js',
  },
})
