import { defineConfig } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: 'file:./dev_tmp.db',
  },
})
