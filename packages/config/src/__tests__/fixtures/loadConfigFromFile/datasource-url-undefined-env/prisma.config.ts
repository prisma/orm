import { defineConfig, env } from 'src/index'

export default defineConfig({
  datasource: {
    url: env('UNDEFINED_VARIABLE'),
  },
})
