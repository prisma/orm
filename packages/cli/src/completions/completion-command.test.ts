import { parseCompletionCommand } from './Completions'

function captureCompletionOutput(argv: string[]): { result: string | Error; output: string[] } {
  const output: string[] = []
  const consoleLog = jest.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))

  try {
    return { result: parseCompletionCommand(argv, 'prisma'), output }
  } finally {
    consoleLog.mockRestore()
  }
}

describe('completion command', () => {
  test('completes top-level commands', () => {
    const { result, output } = captureCompletionOutput(['--', 'g'])

    expect(result).toBe('')
    expect(output).toEqual(['generate\tGenerate artifacts (e.g. Prisma Client)', ':4'])
  })

  test('completes nested commands', () => {
    const { result, output } = captureCompletionOutput(['--', 'migrate', 'd'])

    expect(result).toBe('')
    expect(output).toEqual([
      'dev\tCreate and apply migrations in development',
      'deploy\tApply pending migrations to the database',
      'diff\tCompare the database schema from two arbitrary sources',
      ':4',
    ])
  })

  test('completes option values', () => {
    const { result, output } = captureCompletionOutput(['--', 'generate', '--schema', ''])

    expect(result).toBe('')
    expect(output).toEqual([
      'prisma/schema.prisma\tDefault schema path',
      './schema.prisma\tSchema in project root',
      ':4',
    ])
  })

  test('completes the default Prisma 7 config path', () => {
    const { result, output } = captureCompletionOutput(['--', 'generate', '--config', ''])

    expect(result).toBe('')
    expect(output).toEqual(['prisma7.config.ts\tDefault config path', ':4'])
  })

  test('generates a shell integration script', () => {
    const { result, output } = captureCompletionOutput(['fish'])

    expect(result).toBe('')
    expect(output).toHaveLength(1)
    expect(output[0]).toContain('prisma complete -- $args[2..-1] "$lastArg"')
    expect(output[0]).toContain('complete -c prisma')
  })

  test('rejects unsupported shells', () => {
    const { result, output } = captureCompletionOutput(['unsupported'])

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('Invalid shell type. Must be one of: zsh, bash, fish, powershell')
    expect(output).toEqual([])
  })
})
