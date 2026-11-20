import path from 'path'
import * as ts from 'typescript'

const baseTsConfig = require('../../tsconfig.base.json').compilerOptions

const dirPath = path.join(__dirname, '..', 'src')
const accelerateTs = path.resolve(dirPath, 'accelerate.ts')
const adapterTs = path.resolve(dirPath, 'adapter.ts')
const accelerateAndAdapterTs = path.resolve(dirPath, 'accelerate-adapter.ts')
const defaultTs = path.resolve(dirPath, 'default.ts')
const emptyTs = path.resolve(dirPath, 'empty.ts')

describe('Typechecking', () => {
  const options = { module: 'ES2022', moduleResolution: 'Bundler' } as const

  test('constructor with accelerateUrl', () => {
    typeCheck(accelerateTs, options)
  })

  test('constructor with adapter', () => {
    typeCheck(adapterTs, options)
  })

  test('default constructor', () => {
    expect(() => typeCheck(defaultTs, options)).toThrow()
  })

  test('empty constructor', () => {
    expect(() => typeCheck(emptyTs, options)).toThrow()
  })

  test('constructor with both adapter and accelerateUrl', () => {
    expect(() => typeCheck(accelerateAndAdapterTs, options)).toThrow()
  })
})

function typeCheck(fileName: string, options: Record<string, string>) {
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
