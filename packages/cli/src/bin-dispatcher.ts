#!/usr/bin/env node

if (process.argv[2] === 'complete') {
  require('./completion.js')
} else {
  require('./cli.js')
}
