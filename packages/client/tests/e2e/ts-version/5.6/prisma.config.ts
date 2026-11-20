// FIXME: `defineConfig` is broken with TypeScript 5.4–5.6
// import { defineConfig } from 'prisma/config'

export default {
  datasource: {
    url: 'file:./db',
  },
}
