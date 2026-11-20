import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { detectProjectState, getModelNames, getSeedCommand } from '../project-state'

const SUPPORTED_CONFIG_EXTENSIONS = ['js', 'ts', 'mjs', 'cjs', 'mts', 'cts'] as const
const LEGACY_CONFIG_CANDIDATES = [
  'prisma.config',
  path.join('.config', 'prisma'),
  path.join('.config', 'prisma.config'),
].flatMap((basename) =>
  SUPPORTED_CONFIG_EXTENSIONS.flatMap((extension) => [
    `${basename}.${extension}`,
    path.join(basename, `index.${extension}`),
  ]),
)

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-bootstrap-state-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeConfig(configPath: string, content = 'export default {}') {
  const fullPath = path.join(tmpDir, configPath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf-8')
}

describe('detectProjectState', () => {
  test('returns all false for empty directory', () => {
    const state = detectProjectState(tmpDir)

    expect(state.hasPackageJson).toBe(false)
    expect(state.hasSchemaFile).toBe(false)
    expect(state.hasPrismaConfig).toBe(false)
    expect(state.hasEnvFile).toBe(false)
    expect(state.hasModels).toBe(false)
    expect(state.hasSeedScript).toBe(false)
  })

  test('detects package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf-8')
    const state = detectProjectState(tmpDir)

    expect(state.hasPackageJson).toBe(true)
  })

  test('detects prisma/schema.prisma', () => {
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir)
    fs.writeFileSync(path.join(prismaDir, 'schema.prisma'), `datasource db { provider = "postgresql" }`, 'utf-8')
    const state = detectProjectState(tmpDir)

    expect(state.hasSchemaFile).toBe(true)
    expect(state.hasModels).toBe(false)
  })

  test('detects schema.prisma at root', () => {
    fs.writeFileSync(path.join(tmpDir, 'schema.prisma'), `datasource db { provider = "postgresql" }`, 'utf-8')
    const state = detectProjectState(tmpDir)

    expect(state.hasSchemaFile).toBe(true)
  })

  test('detects models in schema', () => {
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir)
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      `
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

model User {
  id   Int    @id @default(autoincrement())
  name String
}
`,
      'utf-8',
    )
    const state = detectProjectState(tmpDir)

    expect(state.hasModels).toBe(true)
  })

  test('detects prisma.config.ts', () => {
    fs.writeFileSync(path.join(tmpDir, 'prisma.config.ts'), 'export default {}', 'utf-8')
    const state = detectProjectState(tmpDir)

    expect(state.hasPrismaConfig).toBe(true)
  })

  describe.each([
    { directory: '', basename: 'prisma7.config' },
    { directory: '.config', basename: 'prisma7' },
  ])('$directory', ({ directory, basename }) => {
    test.each(SUPPORTED_CONFIG_EXTENSIONS)('detects the .%s config extension', (extension) => {
      writeConfig(path.join(directory, `${basename}.${extension}`))

      expect(detectProjectState(tmpDir).hasPrismaConfig).toBe(true)
    })
  })

  test.each(LEGACY_CONFIG_CANDIDATES)('detects the supported legacy config at %s', (configPath) => {
    writeConfig(configPath)

    expect(detectProjectState(tmpDir).hasPrismaConfig).toBe(true)
  })

  test('detects .env', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'DATABASE_URL=test', 'utf-8')
    const state = detectProjectState(tmpDir)

    expect(state.hasEnvFile).toBe(true)
  })

  test('detects seed script in package.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ prisma: { seed: 'ts-node prisma/seed.ts' } }),
      'utf-8',
    )
    const state = detectProjectState(tmpDir)

    expect(state.hasSeedScript).toBe(true)
  })

  test('returns false for seed when prisma.seed is empty', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ prisma: { seed: '' } }), 'utf-8')
    const state = detectProjectState(tmpDir)

    expect(state.hasSeedScript).toBe(false)
  })

  test('returns false for seed when prisma key is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8')
    const state = detectProjectState(tmpDir)

    expect(state.hasSeedScript).toBe(false)
  })

  test('detects seed script in prisma.config.ts', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'prisma.config.ts'),
      `import { defineConfig } from 'prisma/config'\nexport default defineConfig({ migrations: { seed: 'tsx ./prisma/seed.ts' } })`,
      'utf-8',
    )
    const state = detectProjectState(tmpDir)

    expect(state.hasSeedScript).toBe(true)
  })

  test('detects seed script in prisma.config.ts with different formatting', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'prisma.config.ts'),
      `export default defineConfig({\n  migrations: {\n    seed: "npx tsx prisma/seed.ts",\n  },\n})`,
      'utf-8',
    )
    const state = detectProjectState(tmpDir)

    expect(state.hasSeedScript).toBe(true)
  })

  test('returns false for seed when prisma.config.ts has no seed field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'prisma.config.ts'),
      `export default defineConfig({ migrations: { path: 'prisma/migrations' } })`,
      'utf-8',
    )
    const state = detectProjectState(tmpDir)

    expect(state.hasSeedScript).toBe(false)
  })

  test('reads seed metadata from the selected config without executing it', () => {
    writeConfig(
      'prisma7.config.cts',
      `throw new Error('must not execute')\nexport default { migrations: { seed: 'node selected-seed.js' } }`,
    )
    writeConfig(path.join('.config', 'prisma7.js'), `export default {}`)
    writeConfig('prisma.config.js', `export default {}`)

    expect(detectProjectState(tmpDir).hasSeedScript).toBe(true)
  })

  test('uses extension precedence when inspecting seed metadata', () => {
    writeConfig('prisma7.config.js')
    writeConfig('prisma7.config.ts', `export default { migrations: { seed: 'node ignored-seed.js' } }`)

    expect(detectProjectState(tmpDir).hasSeedScript).toBe(false)
  })

  test('uses the versioned .config location before a legacy root config', () => {
    writeConfig(path.join('.config', 'prisma7.mts'), `export default { migrations: { seed: 'node selected-seed.js' } }`)
    writeConfig('prisma.config.js')

    expect(detectProjectState(tmpDir).hasSeedScript).toBe(true)
  })

  test.each([
    {
      selected: path.join('prisma.config', 'index.cts'),
      lowerPrecedence: path.join('.config', 'prisma.js'),
    },
    {
      selected: path.join('.config', 'prisma', 'index.cts'),
      lowerPrecedence: path.join('.config', 'prisma.config.js'),
    },
  ])('inspects $selected before $lowerPrecedence for seed metadata', ({ selected, lowerPrecedence }) => {
    writeConfig(selected)
    writeConfig(lowerPrecedence, `export default { migrations: { seed: 'node ignored-seed.js' } }`)

    expect(detectProjectState(tmpDir).hasSeedScript).toBe(false)
  })
})

describe('getModelNames', () => {
  test('returns empty array when no schema exists', () => {
    expect(getModelNames(tmpDir)).toEqual([])
  })

  test('extracts model names from schema', () => {
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir)
    fs.writeFileSync(
      path.join(prismaDir, 'schema.prisma'),
      `
datasource db { provider = "postgresql" }

model User {
  id   Int    @id
  name String
  posts Post[]
}

model Post {
  id     Int    @id
  title  String
  author User   @relation(fields: [authorId], references: [id])
  authorId Int
}
`,
      'utf-8',
    )

    expect(getModelNames(tmpDir)).toEqual(['User', 'Post'])
  })

  test('returns empty array for schema without models', () => {
    const prismaDir = path.join(tmpDir, 'prisma')
    fs.mkdirSync(prismaDir)
    fs.writeFileSync(path.join(prismaDir, 'schema.prisma'), `datasource db { provider = "postgresql" }`, 'utf-8')

    expect(getModelNames(tmpDir)).toEqual([])
  })
})

describe('getSeedCommand', () => {
  test('returns null when no seed config exists', () => {
    expect(getSeedCommand(tmpDir)).toBeNull()
  })

  test('returns seed command from package.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ prisma: { seed: 'ts-node prisma/seed.ts' } }),
      'utf-8',
    )

    expect(getSeedCommand(tmpDir)).toBe('ts-node prisma/seed.ts')
  })

  test('returns seed command from prisma.config.ts', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'prisma.config.ts'),
      `export default defineConfig({ migrations: { seed: 'npx tsx prisma/seed.ts' } })`,
      'utf-8',
    )

    expect(getSeedCommand(tmpDir)).toBe('npx tsx prisma/seed.ts')
  })

  test('returns the seed command from the effective versioned config', () => {
    writeConfig('prisma7.config.cjs', `module.exports = { migrations: { seed: 'node selected-seed.js' } }`)
    writeConfig(path.join('.config', 'prisma7.js'), `export default { migrations: { seed: 'node ignored-seed.js' } }`)
    writeConfig('prisma.config.js', `export default { migrations: { seed: 'node legacy-seed.js' } }`)

    expect(getSeedCommand(tmpDir)).toBe('node selected-seed.js')
  })

  test('returns the seed command from the final legacy index location', () => {
    writeConfig(
      path.join('.config', 'prisma.config', 'index.mts'),
      `export default { migrations: { seed: 'node selected-seed.js' } }`,
    )

    expect(getSeedCommand(tmpDir)).toBe('node selected-seed.js')
  })

  test('prefers package.json over the effective config file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ prisma: { seed: 'ts-node prisma/seed.ts' } }),
      'utf-8',
    )
    writeConfig(
      path.join('.config', 'prisma7.cts'),
      `export default defineConfig({ migrations: { seed: 'npx tsx prisma/seed.ts' } })`,
    )

    expect(getSeedCommand(tmpDir)).toBe('ts-node prisma/seed.ts')
  })
})
