import fs from 'node:fs'

import type * as esbuild from 'esbuild'

import { build } from '../../../helpers/compile/build'

const executablePlugin: esbuild.Plugin = {
  name: 'executable',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return

      const filename = './build/prisma7.js'
      const mode = fs.statSync(filename).mode
      fs.chmodSync(filename, mode | 0o111)
    })
  },
}

fs.rmSync('./build/index.js', { force: true })

void build([
  {
    name: 'prisma7',
    entryPoints: ['src/bin.ts'],
    outfile: 'build/prisma7',
    bundle: true,
    external: ['prisma/build/index.js'],
    emitTypes: false,
    minify: true,
    plugins: [executablePlugin],
  },
  {
    name: 'prisma7-types',
    entryPoints: ['src/index.ts'],
    outfile: 'index',
    bundle: true,
    external: ['prisma'],
    minify: true,
  },
  {
    name: 'prisma7-config',
    entryPoints: ['src/config.ts'],
    outfile: 'config',
    bundle: true,
    external: ['prisma'],
    minify: true,
  },
])
