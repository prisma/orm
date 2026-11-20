import path from 'node:path'

import { defineConfig } from '@prisma/config'

const basePath = process.cwd()

export default defineConfig({
  datasource: {
    url: 'postgresql://johndoe:randompassword@doesnotexist:5432/mydb?schema=public',
  },
  schema: path.join(basePath, 'prisma', 'invalid-url.prisma'),
})
