import path from 'node:path'

import { defineConfig } from '@prisma/config'

const basePath = process.cwd()

export default defineConfig({
  datasource: {
    url: 'postgres://user:password@cockroach.invalid:26257/clustername.defaultdb?sslmode=verify-full&sslrootcert=$HOME/.postgresql/root.crt&options=--cluster%3Dclustername',
  },
  schema: path.join(basePath, 'prisma', 'invalid-url.prisma'),
})
