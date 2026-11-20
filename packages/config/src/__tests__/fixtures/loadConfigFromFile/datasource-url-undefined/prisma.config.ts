import { defineConfig } from 'src/index'

export default defineConfig({
  datasource: {
    url: process.env['UNDEFINED_VARIABLE'],
  },
})
