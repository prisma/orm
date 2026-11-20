import { defineConfig } from '@prisma/config'
export default defineConfig({
  datasource: {
    url: 'file:./dev.db',
  },
  earlyAccess: true,
  migrations: {
    seed: 'node prisma/seed.js --my-custom-arg-from-config-1 my-value --my-custom-arg-from-config-2=my-value -y',
  },
})
