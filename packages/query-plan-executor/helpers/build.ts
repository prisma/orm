import fs from 'node:fs/promises'
import path from 'node:path'

import { build } from '../../../helpers/compile/build'

void build([
  {
    name: 'cjs',
    format: 'cjs',
    bundle: true,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index',
    outExtension: { '.js': '.js' },
    emitTypes: true,
  },
]).then(() =>
  fs.rm(path.join(__dirname, '..', 'dist', 'src'), {
    recursive: true,
    force: true,
  }),
)
