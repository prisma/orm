import { checkbox, input } from '@inquirer/prompts'
import fs from 'fs/promises'
import path from 'path'
import { $ } from 'zx'

import { Providers } from '../../tests/functional/_utils/providers'

const TESTS_ROOT = path.resolve(__dirname, '..', '..', 'tests', 'functional')

const allProviders = Object.keys(Providers)

async function main() {
  const testName = await input({
    message: 'Name of the new test',
    validate: (input) => input.trim().length > 0,
  })

  const providers = await checkbox({
    message: 'Which providers do you want to use?',
    choices: allProviders.map((provider) => ({
      name: Providers[provider],
      value: provider,
      checked: true,
    })),
    validate: (input) => input.length > 0,
  })

  const optedOutProviders = allProviders
    .filter((provider) => !providers.includes(provider))
    .map((provider) => Providers[provider])

  let optOutReason = ''
  if (optedOutProviders.length > 0) {
    optOutReason = await input({
      message: `Reason for opting out of ${optedOutProviders.join(', ')}`,
      validate: (input) => input.trim().length > 0,
    })
  }

  const baseDir = path.join(TESTS_ROOT, testName)

  await mkFile(
    path.join(baseDir, '_matrix.ts'),
    (relImport) =>
      `
    import { defineMatrix } from '${relImport('_utils/defineMatrix')}'
    import { Providers } from '${relImport('_utils/providers')}'
    
    export default defineMatrix(() => [
      [
        ${providers.map((provider) => `{provider: Providers.${provider}}`).join(',\n')}
      ],
    ])
  `,
  )

  await mkFile(path.join(baseDir, 'test.ts'), () => {
    let optOutBlock = ''
    if (optedOutProviders.length > 0) {
      optOutBlock = `, {
      optOut: {
        from: [${optedOutProviders.map((provider) => `"${provider}"`).join(', ')}],
        reason: "${optOutReason}"
      }
    }`
    }
    return `
    import testMatrix from './_matrix'
    // @ts-ignore
    import type { PrismaClient } from './node_modules/@prisma/client'
    
    declare let prisma: PrismaClient
    
    testMatrix.setupTestSuite((suiteConfig, suiteMeta) => {
      test('example', () => {
        throw new Error('No test defined')
      })
    }${optOutBlock})
    `
  })

  await mkFile(
    path.join(baseDir, 'prisma', '_schema.ts'),
    (relImport) => `
    import { idForProvider } from '${relImport('_utils/idForProvider')}'
    import testMatrix from '../_matrix'
    
    export default testMatrix.setupSchema(({ provider }) => {
      return /* Prisma */ \`
      generator client {
        provider = "prisma-client-js"
      }
      
      datasource db {
        provider = "\${provider}"
      }
      
      model User {
        id $\{idForProvider(provider)}
      }
      \`
    })
  `,
  )

  await $`pnpm prettier --write ${baseDir}`
}

type TemplateFactory = (relImport: (testRootRelativePath: string) => string) => string

async function mkFile(at: string, template: TemplateFactory) {
  const atDir = path.dirname(at)
  await fs.mkdir(atDir, { recursive: true })
  const relImport = (testRootRelativePath: string) =>
    path.posix.relative(atDir, path.resolve(TESTS_ROOT, testRootRelativePath))
  await fs.writeFile(at, template(relImport))
}

void main()
