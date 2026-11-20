import { build, BuildOptions } from '../../../helpers/compile/build'

const buildOptions = {
  name: 'default',
  bundle: true,
  outfile: 'dist/index',
  entryPoints: ['src/index.ts'],
  external: ['@opentelemetry/api', '@opentelemetry/instrumentation'],
} satisfies BuildOptions

void build([
  { ...buildOptions, format: 'cjs', emitTypes: true, outExtension: { '.js': '.js' } },
  { ...buildOptions, format: 'esm', outExtension: { '.js': '.mjs' } },
])
