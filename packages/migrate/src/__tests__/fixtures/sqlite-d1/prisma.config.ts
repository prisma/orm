import path from 'node:path'
import { defineConfig } from '@prisma/config'
import { PrismaD1 } from '@prisma/adapter-d1'

type Env = {
  CLOUDFLARE_D1_TOKEN: string
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_DATABASE_ID: string
}

const env = {
  CLOUDFLARE_D1_TOKEN: '$CLOUDFLARE_D1_TOKEN',
  CLOUDFLARE_ACCOUNT_ID: '$CLOUDFLARE_ACCOUNT_ID',
  CLOUDFLARE_DATABASE_ID: '$CLOUDFLARE_DATABASE_ID',
} satisfies Env

export default defineConfig({
  experimental: {
    adapter: true,
  },
  schema: path.join('schema.prisma'),
  engine: 'js',
  async adapter() {
    return new PrismaD1({
      CLOUDFLARE_D1_TOKEN: env.CLOUDFLARE_D1_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_DATABASE_ID: env.CLOUDFLARE_DATABASE_ID,
    })
  },
})
