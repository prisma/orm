// CommonJS wrapper to load qpe-worker.ts via tsx.
// This is needed because Node.js 20 doesn't recognize .ts/.mts extensions when spawning workers,
// even with --import tsx in execArgv. Using a .cjs entry point with tsx registration
// works reliably across Node.js versions.

'use strict'

require('tsx')
require('./qpe-worker.ts')
