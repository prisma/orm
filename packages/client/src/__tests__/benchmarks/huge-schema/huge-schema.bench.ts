// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'

import { withCodSpeed } from '@codspeed/benchmark.js-plugin'
import Benchmark from 'benchmark'
import { execaSync } from 'execa'

import { compileFile } from '../../../utils/compileFile'
import { generateTestClient } from '../../../utils/getTestClient'

let suite = withCodSpeed(new Benchmark.Suite('typescript')).add('client generation ~50 Models', {
  defer: true,
  fn: function (deferred) {
    generateTestClient({ projectDir: __dirname })
      .then(() => {
        deferred.resolve()
      })
      .catch((err) => {
        console.error(err)
        process.exit(1)
      })
  },
})

if (!process.env.CODSPEED_BENCHMARK) {
  suite = suite.add('typescript compilation ~50 Models', {
    defer: true,
    fn: function (deferred) {
      compileFile(path.join(__dirname, './compile.ts'), { isolateCompiler: false })
        .then(() => {
          deferred.resolve()
        })
        .catch((err) => {
          console.error(err)
          process.exit(1)
        })
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
suite
  .on('cycle', (event) => {
    // Output benchmark result by converting benchmark result to string
    console.log(String(event.target))
  })
  .on('complete', () => {
    printSize('./node_modules/@prisma/client')
    printSize('./node_modules/.prisma/client')
    printSize('./node_modules/.prisma/client/index.d.ts')
    printSize('./node_modules/.prisma/client/index.js')
    execaSync('rm', ['-rf', `./dotPlusAtPrismaClientFolder.zip`], {
      stdout: 'pipe',
      cwd: __dirname,
    })
    execaSync(
      'zip',
      ['-r', 'dotPlusAtPrismaClientFolder.zip', './node_modules/.prisma/client', './node_modules/@prisma/client'],
      {
        stdout: 'pipe',
        cwd: __dirname,
      },
    )
    printSize('./dotPlusAtPrismaClientFolder.zip')
  })
  .run()

function printSize(targetPath: string): void {
  const size = getSize(path.join(__dirname, targetPath)) / 1024 / 1024
  console.log(
    `${targetPath.replace('./node_modules/', '').replace('./', '')} size x ${size} MB ±0.00% (1 runs sampled)`,
  )
}

function getSize(targetPath: string): number {
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) {
    return stat.size
  }

  if (stat.isDirectory()) {
    return fs
      .readdirSync(targetPath)
      .filter((fileName) => fileName !== '.' && fileName !== '..')
      .map((subPath) => getSize(path.join(targetPath, subPath)))
      .reduce((a, b) => a + b)
  }
  return 0
}
