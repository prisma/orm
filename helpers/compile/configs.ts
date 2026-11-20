import path from 'node:path'

import { BuildOptions } from './build'

type AdapterEntry = {
  entry: string
  outfile: string
}

export function createBundledConfig(entries: AdapterEntry[]): BuildOptions[] {
  return entries.flatMap(({ entry, outfile }) => {
    const baseName = path.basename(outfile)

    return [
      {
        name: `${baseName}-cjs`,
        format: 'cjs' as const,
        bundle: true,
        entryPoints: [entry],
        outfile,
        outExtension: { '.js': '.js' },
        emitTypes: true,
      },
      {
        name: `${baseName}-esm`,
        format: 'esm' as const,
        bundle: true,
        entryPoints: [entry],
        outfile,
        outExtension: { '.js': '.mjs' },
        emitTypes: true,
      },
    ]
  })
}

export const bundledConfig = createBundledConfig([{ entry: 'src/index.ts', outfile: 'dist/index' }])

export const unbundledConfig: BuildOptions[] = [
  {
    name: 'cjs',
    format: 'cjs',
    entryPoints: ['src/**/*.ts'],
    outdir: 'dist',
    outExtension: { '.js': '.js' },
    emitTypes: true,
  },
  {
    name: 'esm',
    format: 'esm',
    entryPoints: ['src/**/*.ts'],
    outdir: 'dist',
    outExtension: { '.js': '.mjs' },
    emitTypes: true,
  },
]
