const path = require('node:path')

global.beforeEach(() => {
  /**
   * Set up JITI aliasing for the test environment.
   * This allows us to load local modules in fixture tests using the `src/` and `test-utils/` aliases.
   * Importing `src/index`, in particular, emulates real-world usage of `import { defineConfig } from '@prisma/config'`.
   *
   * See: https://github.com/unjs/jiti?tab=readme-ov-file#alias.
   */
  process.env['JITI_ALIAS'] = JSON.stringify({
    'src/': path.join(__dirname, 'src'),
    'test-utils/': path.join(__dirname, 'src', '__tests__', '_utils'),
  })
})

global.afterEach(() => {
  delete process.env['JITI_ALIAS']
})
