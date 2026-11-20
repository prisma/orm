import path from 'path'
import * as ts from 'typescript'

import { allOptions } from '../../_utils/prisma-client-imports'

const baseTsConfig = require('../../tsconfig.base.json').compilerOptions

const dirPath = path.join(__dirname, '..', 'src')
const depTs = path.resolve(dirPath, 'dep.ts')
const noDepTs = path.resolve(dirPath, 'no-dep.ts')
const defaultTs = path.resolve(dirPath, 'default.ts')

describe('Typechecking', () => {
  test('custom import via dependency', () => {
    for (const options of allOptions) {
      typeCheck(depTs, options)
    }
  })

  test('custom direct import', () => {
    for (const options of allOptions) {
      typeCheck(noDepTs, options)
    }
  })

  test('default import', () => {
    for (const options of allOptions) {
      typeCheck(defaultTs, options)
    }
  })
})

function typeCheck(fileName: string, options: any) {
  console.info(`Typechecking ${fileName} with options:`, options)

  const fullOptions = ts.convertCompilerOptionsFromJson(
    { ...baseTsConfig, ...options },
    path.resolve(__dirname, '..', 'tsconfig.json'),
  )

  assertNoErrors(fullOptions.errors)

  const program = ts.createProgram([fileName], fullOptions.options)

  assertNoErrors(program.getConfigFileParsingDiagnostics())
  assertNoErrors(program.getOptionsDiagnostics())
  const sourceFile = program.getSourceFile(fileName)
  if (!sourceFile) {
    throw new Error(`Source file ${fileName} not found`)
  }
  assertNoErrors(program.getSemanticDiagnostics())
  assertNoErrors(program.getSyntacticDiagnostics())
}

function assertNoErrors(errors: readonly ts.Diagnostic[]) {
  if (errors.length > 0) {
    errors.forEach((error) => console.error(error))

    throw new Error(`Test exited with ${errors.length} errors. See above for details.`)
  }
}
