import { build } from '../../../helpers/compile/build'
import { createBundledConfig } from '../../../helpers/compile/configs'

const bundleConfig = createBundledConfig([
  { entry: 'src/index-node.ts', outfile: 'dist/index-node' },
  { entry: 'src/index-workerd.ts', outfile: 'dist/index-workerd' },
])

void build(bundleConfig)
