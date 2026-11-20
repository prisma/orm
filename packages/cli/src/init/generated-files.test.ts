import path from 'node:path'

import { GeneratedFiles } from './generated-files'

const basePath = (...segments: string[]) => path.join(process.cwd(), 'generated-files-tests', ...segments)

describe('GeneratedFiles', () => {
  it('formats nested directory trees with directory headers and indentation', () => {
    const files = new GeneratedFiles(basePath('my-project'))
    files.add(path.join(basePath('my-project'), 'schema.prisma'))
    files.add(path.join(basePath('my-project'), 'src', 'client.ts'))
    files.add(path.join(basePath('my-project'), 'src', 'deeply', 'nested', 'index.ts'))

    const formatted = files.format({
      level: 0,
      printHeadersFromLevel: 0,
      indentSize: 2,
    })

    expect(formatted).toMatchInlineSnapshot(`
      "my-project/
        schema.prisma
        src/
          client.ts
          deeply/
            nested/
              index.ts"
    `)
  })

  it('omits headers above the configured print level', () => {
    const files = new GeneratedFiles(basePath('no-root'))
    files.add(path.join(basePath('no-root'), 'schema.prisma'))

    const formatted = files.format({
      level: 0,
      printHeadersFromLevel: 1,
      indentSize: 2,
    })

    expect(formatted).toMatchInlineSnapshot(`"  schema.prisma"`)
  })

  it('adds a trailing slash to directories only when they have children', () => {
    const files = new GeneratedFiles(basePath('slash-check'))

    expect(files.header()).toBe('slash-check')

    files.add(path.join(basePath('slash-check'), 'schema.prisma'))

    expect(files.header()).toBe('slash-check/')

    const [schemaFile] = Array.from(files.entries())

    expect(schemaFile.header()).toBe('schema.prisma')
  })
})
