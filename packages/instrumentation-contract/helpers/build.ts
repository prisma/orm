import { build, BuildOptions } from '../../../helpers/compile/build'

const buildOptions = {
  name: 'index',
  bundle: true,
  outfile: 'dist/index',
  entryPoints: ['src/index.ts'],
  external: ['@opentelemetry/api'],
} satisfies BuildOptions

void build([
  { ...buildOptions, name: 'index-cjs', format: 'cjs', emitTypes: true, outExtension: { '.js': '.js' } },
  { ...buildOptions, name: 'index-esm', format: 'esm', outExtension: { '.js': '.mjs' } },
])
