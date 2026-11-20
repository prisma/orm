import { defineConfig } from '@prisma/config'

// @ts-expect-error — intentionally missing datasource block
export default defineConfig({
  schema: './prisma/schema.prisma',
})
