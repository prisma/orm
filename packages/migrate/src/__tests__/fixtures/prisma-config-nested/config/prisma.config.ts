import { defineConfig } from '@prisma/config'
export default defineConfig({
  datasource: {
    url: 'postgresql://foo:bar@test.com',
  },
})
