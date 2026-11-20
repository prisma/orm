import { defineConfig, type PrismaConfig } from '@prisma/prisma7/config'

const config: PrismaConfig = {
  schema: 'project-models/non-default.prisma',
  datasource: {
    url: 'file:./compatibility.db',
  },
}

export default defineConfig(config)
