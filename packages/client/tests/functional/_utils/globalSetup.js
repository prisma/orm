'use strict'
const glob = require('globby')
const fs = require('fs-extra')

// needed for jest to serialize BigInt: https://github.com/jestjs/jest/issues/11617
BigInt.prototype.toJSON = function () {
  return Number(this)
}

module.exports = (globalConfig) => {
  process.env['JEST_MAX_WORKERS'] = globalConfig.maxWorkers // expose info to test setup

  // we clear up all the files before we run the tests that are not type tests
  if (process.argv.join(' ').includes('--testPathIgnorePatterns typescript')) {
    glob
      // TODO: drop node_modules cleanup?
      .sync(['./tests/functional/**/.generated/', './tests/functional/**/node_modules/'], {
        onlyDirectories: true,
        dot: true,
      })
      .forEach((dir) => fs.removeSync(dir, { recursive: true }))
  }
}
