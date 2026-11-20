import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: 'prisma://localhost:50000/?api_key=1',
  },
})
