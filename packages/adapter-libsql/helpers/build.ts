import { build } from '../../../helpers/compile/build'
import { bundledConfig } from '../../../helpers/compile/configs'

const defaultBuildOptions = bundledConfig.map((opts) => ({
  ...opts,
  entryPoints: ['src/index-node.ts'],
  outfile: 'dist/index-node',
}))

const webBuildOptions = bundledConfig.map((opts) => ({
  ...opts,
  entryPoints: ['src/index-web.ts'],
  outfile: 'dist/index-web',
}))

void build([...defaultBuildOptions, ...webBuildOptions])
