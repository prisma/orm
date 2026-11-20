import { defineConfig } from '@prisma/config/src'
export default defineConfig({
  datasource: {
    url: 'postgresql://foo:bar@test.com',
  },
})
