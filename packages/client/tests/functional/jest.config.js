'use strict'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)

module.exports = () => {
  // Default
  let testTimeout = 30_000
  if (isMacOrWindowsCI) {
    testTimeout = 100_000
  }

  const configCommon = {
    testMatch: ['**/*.ts', '!(**/*.d.ts)', '!(**/_utils/**)', '!(**/_*.ts)', '!(**/.generated/**)'],
    transformIgnorePatterns: [],
    reporters: ['default'],
    globalSetup: './_utils/globalSetup.js',
    snapshotSerializers: ['@prisma/get-platform/src/test-utils/jestSnapshotSerializer'],
    setupFilesAfterEnv: ['./_utils/setupFilesAfterEnv.ts'],
    testTimeout,
    collectCoverage: process.env.CI ? true : false,
    prettierPath: '../../../../node_modules/prettier2',
  }

  if (process.env['JEST_JUNIT_DISABLE'] !== 'true') {
    configCommon.reporters.push([
      'jest-junit',
      {
        addFileAttribute: 'true',
        ancestorSeparator: ' › ',
        classNameTemplate: (vars) => {
          return vars.classname
            .replace(/(\(.*)provider=\w+,? ?(.*\))/, '$1$2')
            .replace(/(\(.*)providerFlavor=\w+,? ?(.*\))/, '$1$2')
            .replace(' ()', '')
        },
        titleTemplate: '{title}',
      },
    ])
  }

  return {
    ...configCommon,
    transform: {
      '^.+\\.(m?j|t)s$': ['./esbuild-transformer', {}],
    },
  }
}
