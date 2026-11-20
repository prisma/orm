import { readFileSync, writeFileSync } from 'node:fs'

import { $ } from 'zx'

import { executeSteps } from '../_utils/executeSteps'
import { retry } from '../_utils/retry'

/**
 * Patches the generated package.json so the @prisma/client-runtime-utils dependency is resolved to the local version of it.
 */
const patchGeneratedPackageJson = () => {
  const pkgJson = readFileSync('./prisma/client/package.json', 'utf8')
  const pkgJsonObj = JSON.parse(pkgJson)
  pkgJsonObj.dependencies['@prisma/client-runtime-utils'] = 'file:/tmp/prisma-client-runtime-utils-0.0.0.tgz'
  writeFileSync('./prisma/client/package.json', JSON.stringify(pkgJsonObj, null, 2))
}

void executeSteps({
  setup: async () => {
    await $`corepack enable`
    await $`cp original.package.json package.json`
  },
  test: async () => {
    await retry(async () => {
      try {
        await $`yarn`
      } catch (e) {
        await $`yarn cache clean`
        throw e
      }
    }, 3)
    await $`yarn prisma generate`
    patchGeneratedPackageJson()
    await $`yarn add db@link:./prisma/client`
  },
  finish: async () => {
    await $`echo "done"`
  },
})
