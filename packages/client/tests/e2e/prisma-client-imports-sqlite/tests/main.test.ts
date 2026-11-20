import path from 'path'
import * as ts from 'typescript'

import { allOptions } from '../../_utils/prisma-client-imports'

const baseTsConfig = require('../../tsconfig.base.json').compilerOptions

const dirPath = path.join(__dirname, '..', 'src')
const depTs = path.resolve(dirPath, 'dep.ts')
const noDepTs = path.resolve(dirPath, 'no-dep.ts')
const defaultTs = path.resolve(dirPath, 'default.ts')

const dirPathEsm = path.join(__dirname, '..', 'src', 'esm-only-pkgs')
const depEsmTs = path.resolve(dirPathEsm, 'dep.ts')
const noDepEsmTs = path.resolve(dirPathEsm, 'no-dep.ts')
const defaultEsmTs = path.resolve(dirPathEsm, 'default.ts')

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

/*
 * @libsql/client is an ECMAScript module
 * Some options needs to be filtered out because they would fail with:
 * The current file is a CommonJS module whose imports will produce 'require' calls; however, the referenced file is an ECMAScript module and cannot be imported with 'require'. Consider writing a dynamic 'import("@libsql/client")' call instead.
 */
describe('Typechecking: ESM only packages', () => {
  const esmCompatibleOptions = allOptions.filter((options) => {
    return (
      options.module !== 'Node16' &&
      options.moduleResolution !== 'Node16' &&
      options.module !== 'NodeNext' &&
      options.moduleResolution !== 'NodeNext' &&
      options.module !== 'commonjs'
    )
  })

  test('custom import via dependency', () => {
    for (const options of esmCompatibleOptions) {
      typeCheck(depEsmTs, options)
    }
  })

  test('custom direct import', () => {
    for (const options of esmCompatibleOptions) {
      typeCheck(noDepEsmTs, options)
    }
  })

  test('default import', () => {
    for (const options of esmCompatibleOptions) {
      typeCheck(defaultEsmTs, options)
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
