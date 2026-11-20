import path from 'node:path'

import { afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  /**
   * Set up JITI aliasing for the test environment.
   * This allows us to load local modules in fixture tests using the `src/` alias.
   * Importing `src/index`, in particular, emulates real-world usage of `import { defineConfig } from '@prisma/config'`.
   *
   * See: https://github.com/unjs/jiti?tab=readme-ov-file#alias.
   */
  process.env['JITI_ALIAS'] = JSON.stringify({
    'src/': path.join(__dirname, 'src'),
  })
})

afterEach(() => {
  delete process.env['JITI_ALIAS']
})
