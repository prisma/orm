import assert from 'assert'
import glob from 'globby'
import path from 'path'
import ts from 'typescript'

import { keys } from '../../../../../helpers/blaze/keys'
import { map } from '../../../../../helpers/blaze/map'
import { reduce } from '../../../../../helpers/blaze/reduce'

const testsRoot = path.resolve(__dirname, '..')

const ignoredTsErrors = [`An import alias cannot reference a declaration that was exported using 'export type'`]

function getAllTestSuiteTypeChecks(fileNames: string[]) {
  const options = ts.convertCompilerOptionsFromJson(
    require('../../../../../tsconfig.build.regular.json').compilerOptions,
    path.dirname(expect.getState().testPath),
  ).options

  // currently used to resolve `@prisma/client/runtime` for client extensions for default-index.d.ts
  // this tells it that imports from `@prisma/client/runtime` should be resolved to the runtime folder
  options.paths ??= {}
  options.paths['@prisma/client/runtime/client'] = [path.resolve(__dirname, '..', '..', '..', 'runtime', 'client')]

  const program = ts.createProgram(fileNames, {
    ...options,
    skipLibCheck: false,
    noEmit: true,
  })

  return reduce(
    program.getSemanticDiagnostics(),
    (acc, diagnostic) => {
      if (diagnostic.file) {
        const filePath = diagnostic.file.fileName
        const diagnosticMessage = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start!)
        const displayMessage = `${diagnosticMessage} At: ${filePath}:${line + 1}:${character + 1}`

        // in some cases, we want to ignore certain errors that only occur in tests
        if (!process.env.CI && ignoredTsErrors.filter((e) => displayMessage.match(e)).length > 0) {
          return acc // this error only happens in watch or dev mode, so we ignore it
        }

        if (displayMessage) return { ...acc, ...{ [filePath]: displayMessage } }
      }

      return acc
    },
    {} as { [key: string]: string },
  )
}

describe('typescript', () => {
  const suitePaths = glob
    .sync('./**/.generated/**/*.ts', {
      ignore: ['./**/.generated/**/*.d.ts', './**/.generated/**/_schema*'],
    })
    // global.d.ts does not really need typechecking, but since no sources
    // import it directly, it has to be included in the source set in order for
    // global `describeIf` and `testIf` to be discovered
    .concat([path.resolve(__dirname, '..', 'globals.d.ts')])

  const suiteChecks = getAllTestSuiteTypeChecks(suitePaths)
  const suiteTable = map(suitePaths, (path) => [getTestSuiteDisplayName(path), path])

  if (suiteTable.length === 0) return test('No test suites found', () => {})

  test.each(suiteTable)('%s', (_, suiteFilePath) => {
    for (const checkPath of keys(suiteChecks)) {
      if (checkPath.includes(path.dirname(suiteFilePath))) {
        assert.fail(suiteChecks[checkPath])
      }
    }
  })
})

function getTestSuiteDisplayName(filePath: string) {
  const testPath = path.relative(testsRoot, filePath)
  const suiteName = testPath.replace(/^.*\.generated\//g, '')

  return suiteName
}
