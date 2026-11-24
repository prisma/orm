import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

const rootDir = process.cwd()
const fixtureRequire = createRequire(path.join(rootDir, 'package.json'))
const prisma7PackageRequire = createRequire(fixtureRequire.resolve('@prisma/prisma7/package.json'))
const prisma7Bin = path.join(rootDir, 'node_modules', '.bin', 'prisma7')
const prismaBin = prisma7PackageRequire.resolve('prisma/build/index.js')
const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g')

const cliEntrypoints = [
  {
    identity: 'prisma7',
    command: prisma7Bin,
    argsPrefix: [],
    configImport: '@prisma/prisma7/config',
  },
  {
    identity: 'prisma',
    command: process.execPath,
    argsPrefix: [prismaBin],
    configImport: 'prisma/config',
  },
] as const

type CommandOutput = {
  status: number | null
  stderr: string
  stdout: string
}

type ProjectFiles = {
  prismaConfig: string
  schema: string
}

type VersionProjection = {
  json: {
    clientVersion: unknown
    distributionKey: 'prisma7'
    distributionVersion: unknown
    hasPrismaKey: boolean
    metadataKeys: string[]
  }
  text: {
    clientLabel: '@prisma/client'
    clientVersion: string
    distributionLabel: 'prisma7'
    distributionVersion: string
    hasPrismaLabel: boolean
    metadataLabels: string[]
    stderr: string
  }
}

function normalizeText(text: string, replacements: ReadonlyArray<readonly [string, string]>): string {
  let normalized = text.replace(/\r\n/g, '\n').replace(ansiPattern, '').trimEnd()

  for (const [from, to] of replacements) {
    normalized = normalized.split(from).join(to)
  }

  return normalized
}

function normalizeValue(value: unknown, replacements: ReadonlyArray<readonly [string, string]>): unknown {
  if (typeof value === 'string') {
    return normalizeText(value, replacements)
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, replacements))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry, replacements)]))
  }

  return value
}

function getVersionRows(stdout: string): Map<string, string> {
  return new Map(
    stdout
      .split('\n')
      .map((line) => line.match(/^(?<label>.+?)\s+:\s+(?<value>.*)$/)?.groups)
      .filter((groups): groups is { label: string; value: string } => groups !== undefined)
      .map(({ label, value }) => [label, value]),
  )
}

function projectVersion(versionText: CommandOutput, versionJson: Record<string, unknown>): VersionProjection {
  const rows = getVersionRows(versionText.stdout)

  return {
    json: {
      clientVersion: versionJson['@prisma/client'],
      distributionKey: 'prisma7',
      distributionVersion: versionJson.prisma7,
      hasPrismaKey: Object.hasOwn(versionJson, 'prisma'),
      metadataKeys: Object.keys(versionJson)
        .filter((key) => key !== '@prisma/client' && key !== 'prisma7')
        .sort(),
    },
    text: {
      clientLabel: '@prisma/client',
      clientVersion: rows.get('@prisma/client') ?? '',
      distributionLabel: 'prisma7',
      distributionVersion: rows.get('prisma7') ?? '',
      hasPrismaLabel: rows.has('prisma'),
      metadataLabels: [...rows.keys()].filter((label) => label !== '@prisma/client' && label !== 'prisma7'),
      stderr: versionText.stderr,
    },
  }
}

function execute(
  command: string,
  args: string[],
  cwd = rootDir,
  envOverrides: Record<string, string | undefined> = {},
): CommandOutput {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      ...envOverrides,
    },
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function run(
  command: string,
  args: string[],
  cwd = rootDir,
  envOverrides: Record<string, string | undefined> = {},
): CommandOutput {
  const result = execute(command, args, cwd, envOverrides)

  expect(
    result.status,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  ).toBe(0)

  return result
}

function runExpectFailure(
  command: string,
  args: string[],
  cwd = rootDir,
  envOverrides: Record<string, string | undefined> = {},
): CommandOutput {
  const result = execute(command, args, cwd, envOverrides)

  expect(
    result.status,
    `${command} ${args.join(' ')} unexpectedly succeeded\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  ).not.toBe(0)

  return result
}

function combinedOutput(output: CommandOutput, replacements: ReadonlyArray<readonly [string, string]>): string {
  return normalizeText(`${output.stdout}\n${output.stderr}`, replacements)
}

async function writeProject(dir: string, files: ProjectFiles): Promise<void> {
  await mkdir(path.join(dir, 'prisma'), { recursive: true })
  await writeFile(path.join(dir, 'package.json'), '{"private":true}\n')
  await writeFile(path.join(dir, 'prisma.config.ts'), files.prismaConfig)
  await writeFile(path.join(dir, 'prisma', 'schema.prisma'), files.schema)
}

for (const cli of cliEntrypoints) {
  test(`${cli.identity} honors the installed Prisma 7 config contract`, async () => {
    const precedenceProjectDir = await mkdtemp(path.join(os.tmpdir(), `${cli.identity}-config-precedence-`))
    const invalidProjectDir = await mkdtemp(path.join(os.tmpdir(), `${cli.identity}-config-invalid-`))
    const legacyProjectDir = await mkdtemp(path.join(os.tmpdir(), `${cli.identity}-config-legacy-`))
    const initProjectDir = await mkdtemp(path.join(os.tmpdir(), `${cli.identity}-config-init-`))

    const runCli = (args: string[], cwd: string) => run(cli.command, [...cli.argsPrefix, ...args], cwd)
    const runCliExpectFailure = (args: string[], cwd: string) =>
      runExpectFailure(cli.command, [...cli.argsPrefix, ...args], cwd)

    try {
      await writeFile(path.join(precedenceProjectDir, 'package.json'), '{"private":true}\n')
      await writeFile(path.join(precedenceProjectDir, 'prisma7.config.ts'), 'export default {}\n')
      await writeFile(path.join(precedenceProjectDir, 'prisma.config.ts'), 'export default {}\n')

      const precedence = runCli(['--help'], precedenceProjectDir)
      expect(normalizeText(precedence.stderr, [])).toBe('Loaded Prisma config from prisma7.config.ts.')

      await writeFile(path.join(invalidProjectDir, 'package.json'), '{"private":true}\n')
      await writeFile(
        path.join(invalidProjectDir, 'prisma7.config.ts'),
        'throw new Error("installed versioned config failure")\n',
      )
      await writeFile(path.join(invalidProjectDir, 'prisma.config.ts'), 'export default {}\n')

      const invalid = runCliExpectFailure(['--help'], invalidProjectDir)
      const invalidOutput = combinedOutput(invalid, [])
      expect(invalidOutput).toContain('prisma7.config.ts')
      expect(invalidOutput).toContain('installed versioned config failure')
      expect(invalidOutput).not.toContain('Loaded Prisma config from prisma.config.ts.')

      await writeFile(path.join(legacyProjectDir, 'package.json'), '{"private":true}\n')
      await writeFile(path.join(legacyProjectDir, 'prisma.config.ts'), 'export default {}\n')

      const legacy = runCli(['--help'], legacyProjectDir)
      expect(normalizeText(legacy.stderr, [])).toBe('Loaded Prisma config from prisma.config.ts.')

      await writeFile(path.join(initProjectDir, 'package.json'), '{"private":true}\n')
      runCli(['init', '--datasource-provider', 'postgresql', '--no-skills'], initProjectDir)

      const initFiles = await readdir(initProjectDir)
      const generatedConfig = await readFile(path.join(initProjectDir, 'prisma7.config.ts'), 'utf8')
      expect(initFiles).toContain('prisma7.config.ts')
      expect(initFiles).not.toContain('prisma.config.ts')
      expect(generatedConfig).toContain(`from "${cli.configImport}"`)
    } finally {
      await rm(precedenceProjectDir, { recursive: true, force: true })
      await rm(invalidProjectDir, { recursive: true, force: true })
      await rm(legacyProjectDir, { recursive: true, force: true })
      await rm(initProjectDir, { recursive: true, force: true })
    }
  }, 120_000)
}

test('prisma7 snapshots real CLI-owned identity surfaces and keeps the packed smoke green', async () => {
  const initProjectDir = await mkdtemp(path.join(os.tmpdir(), 'prisma7-init-'))
  const migrateProjectDir = await mkdtemp(path.join(os.tmpdir(), 'prisma7-migrate-'))
  const dbPushProjectDir = await mkdtemp(path.join(os.tmpdir(), 'prisma7-db-push-'))
  const noGeneratorProjectDir = await mkdtemp(path.join(os.tmpdir(), 'prisma7-no-generator-'))
  const noModelsProjectDir = await mkdtemp(path.join(os.tmpdir(), 'prisma7-no-models-'))
  const missingClientProjectDir = await mkdtemp(path.join(os.tmpdir(), 'prisma7-missing-client-'))
  const replacements = [
    [rootDir, '<cwd>'],
    [initProjectDir, '<init-project>'],
    [migrateProjectDir, '<migrate-project>'],
    [dbPushProjectDir, '<db-push-project>'],
    [noGeneratorProjectDir, '<no-generator-project>'],
    [noModelsProjectDir, '<no-models-project>'],
    [missingClientProjectDir, '<missing-client-project>'],
    [prisma7Bin, '<prisma7-bin>'],
  ] as const

  try {
    await writeFile(path.join(initProjectDir, 'package.json'), '{"private":true}\n')

    await writeProject(migrateProjectDir, {
      prismaConfig: `import { defineConfig } from '@prisma/prisma7/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {},
})
`,
      schema: `datasource db {
  provider = "sqlite"
}

model User {
  id Int @id @default(autoincrement())
}
`,
    })

    await writeProject(dbPushProjectDir, {
      prismaConfig: `import { defineConfig } from '@prisma/prisma7/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: 'file:./dev.db',
  },
})
`,
      schema: `datasource db {
  provider = "sqlite"
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String
}
`,
    })

    await writeProject(noGeneratorProjectDir, {
      prismaConfig: `import { defineConfig } from '@prisma/prisma7/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
})
`,
      schema: `datasource db {
  provider = "sqlite"
}

model User {
  id Int @id @default(autoincrement())
}
`,
    })

    await writeProject(noModelsProjectDir, {
      prismaConfig: `import { defineConfig } from '@prisma/prisma7/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
})
`,
      schema: `generator client {
  provider = "prisma-client"
  output   = "../generated/client"
}

datasource db {
  provider = "sqlite"
}
`,
    })

    await writeProject(missingClientProjectDir, {
      prismaConfig: `import { defineConfig } from '@prisma/prisma7/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
})
`,
      schema: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
}

model User {
  id Int @id @default(autoincrement())
}
`,
    })

    const topLevelHelp = run('pnpm', ['exec', 'prisma7', '--help'])
    const delegatedHelp = run('pnpm', ['exec', 'prisma7', 'validate', '--help'])
    const versionText = run('pnpm', ['exec', 'prisma7', '--version'])
    const versionJson = JSON.parse(run('pnpm', ['exec', 'prisma7', '--version', '--json']).stdout) as Record<
      string,
      unknown
    >
    const completionZsh = run('pnpm', ['exec', 'prisma7', 'complete', 'zsh'])
    const init = run(prisma7Bin, ['init', '--datasource-provider', 'postgresql', '--no-skills'], initProjectDir)
    const migrateStatus = runExpectFailure(prisma7Bin, ['migrate', 'status'], migrateProjectDir)
    const firstDbPush = run(prisma7Bin, ['db', 'push', '--force-reset'], dbPushProjectDir)

    await writeFile(
      path.join(dbPushProjectDir, 'insert.sql'),
      'INSERT INTO "User" ("email", "name") VALUES (\'a@b.c\', \'Ada\');\n',
    )
    run(prisma7Bin, ['db', 'execute', '--file', 'insert.sql'], dbPushProjectDir)

    await writeFile(
      path.join(dbPushProjectDir, 'prisma', 'schema.prisma'),
      `datasource db {
  provider = "sqlite"
}
`,
    )

    const dbPushDataLoss = runExpectFailure(prisma7Bin, ['db', 'push'], dbPushProjectDir, { GITHUB_ACTIONS: '1' })
    const noGenerator = run(prisma7Bin, ['generate'], noGeneratorProjectDir)
    const noModels = runExpectFailure(prisma7Bin, ['generate', '--require-models'], noModelsProjectDir)
    const missingClient = runExpectFailure(prisma7Bin, ['generate'], missingClientProjectDir)

    const initFiles = (await readdir(initProjectDir)).sort()
    const prismaFiles = (await readdir(path.join(initProjectDir, 'prisma'))).sort()
    const prismaConfig = await readFile(path.join(initProjectDir, 'prisma7.config.ts'), 'utf8')
    const env = await readFile(path.join(initProjectDir, '.env'), 'utf8')

    expect(normalizeValue({ stdout: topLevelHelp.stdout, stderr: topLevelHelp.stderr }, replacements))
      .toMatchInlineSnapshot(`
      {
        "stderr": "Loaded Prisma config from prisma.config.ts.",
        "stdout": "
          ◭  Prisma is a modern DB toolkit to query, migrate and model your database (https://prisma.io)

          Usage

            $ prisma7 [command]

          Commands

                      init   Set up Prisma for your app
                 bootstrap   Bootstrap a Prisma Postgres project
                       dev   Start a local Prisma Postgres server for development
                  generate   Generate artifacts (e.g. Prisma Client)
                        db   Manage your database schema and lifecycle
                   migrate   Migrate your database
                    studio   Browse your data with Prisma Studio
                  validate   Validate your Prisma schema
                    format   Format your Prisma schema
                   version   Displays Prisma version info
                     debug   Displays Prisma debug info
                  platform   Prisma Data Platform commands
                  postgres   Manage Prisma Postgres databases
                       mcp   Starts an MCP server to use with AI development tools
                  complete   Generate shell completion scripts

          Flags

               --preview-feature   Run Preview Prisma commands
               --help, -h          Show additional information about a command

      ┌───────────────────────────────────────────────────────────────────────────────────────┐
      │  Optimize performance through connection pooling and caching with Prisma Accelerate.  │
      │  Learn more at https://pris.ly/cli/pdp                                                │
      └───────────────────────────────────────────────────────────────────────────────────────┘

          Examples

            Set up a new local Prisma Postgres \`prisma7 dev\`-ready project
            $ prisma7 init

            Start a local Prisma Postgres server for development
            $ prisma7 dev

            Generate artifacts (e.g. Prisma Client)
            $ prisma7 generate

            Browse your data
            $ prisma7 studio

            Create migrations from your Prisma schema, apply them to the database, generate artifacts (e.g. Prisma Client)
            $ prisma7 migrate dev

            Pull the schema from an existing database, updating the Prisma schema
            $ prisma7 db pull

            Push the Prisma schema state to the database
            $ prisma7 db push

            Validate your Prisma schema
            $ prisma7 validate

            Format your Prisma schema
            $ prisma7 format

            Display Prisma version info
            $ prisma7 version

            Display Prisma debug info
            $ prisma7 debug",
      }
    `)
    expect(normalizeValue({ stdout: delegatedHelp.stdout, stderr: delegatedHelp.stderr }, replacements))
      .toMatchInlineSnapshot(`
      {
        "stderr": "Loaded Prisma config from prisma.config.ts.",
        "stdout": "
      Validate a Prisma schema.

      Usage

        $ prisma7 validate [options]

      Options

        -h, --help   Display this help message
          --config   Custom path to your Prisma config file
          --schema   Custom path to your Prisma schema

      Examples

        With an existing Prisma schema
          $ prisma7 validate

        With a Prisma config file
          $ prisma7 validate --config=./prisma7.config.ts

        Or specify a Prisma schema path
          $ prisma7 validate --schema=./schema.prisma",
      }
    `)

    const normalizedVersion = normalizeValue(
      projectVersion(versionText, versionJson),
      replacements,
    ) as VersionProjection
    expect(normalizedVersion.text).toMatchInlineSnapshot(`
{
  "clientLabel": "@prisma/client",
  "clientVersion": "0.0.0",
  "distributionLabel": "prisma7",
  "distributionVersion": "0.0.0",
  "hasPrismaLabel": false,
  "metadataLabels": [
    "Operating System",
    "Architecture",
    "Node.js",
    "TypeScript",
    "Query Compiler",
    "PSL",
    "Schema Engine",
    "Default Engines Hash",
    "Studio",
    "Prisma CLI Path",
  ],
  "stderr": "Loaded Prisma config from prisma.config.ts.\n\nPrisma schema loaded from project-models/non-default.prisma.",
}
    `)
    expect(normalizedVersion.json).toMatchInlineSnapshot(`
{
  "clientVersion": "0.0.0",
  "distributionKey": "prisma7",
  "distributionVersion": "0.0.0",
  "hasPrismaKey": false,
  "metadataKeys": [
    "architecture",
    "default-engines-hash",
    "node.js",
    "operating-system",
    "prisma-cli-path",
    "psl",
    "query-compiler",
    "schema-engine",
    "studio",
    "typescript",
  ],
}
    `)

    const normalizedCompletionZsh = normalizeValue(completionZsh, replacements) as CommandOutput
    expect(normalizedCompletionZsh.stderr).toBe('')
    expect(normalizedCompletionZsh.stdout).toContain('#compdef prisma7')
    expect(normalizedCompletionZsh.stdout).toContain('compdef _prisma7 prisma7')
    expect(normalizedCompletionZsh.stdout).toContain('requestComp="prisma7 complete -- ${quoted_args[*]}"')
    expect(normalizedCompletionZsh.stdout).not.toContain('#compdef prisma\n')
    expect(normalizedCompletionZsh.stdout).not.toContain('requestComp="prisma complete -- ${quoted_args[*]}"')

    expect(initFiles).toEqual(['.env', '.gitignore', 'package.json', 'prisma', 'prisma7.config.ts'])
    expect(prismaFiles).toEqual(['schema.prisma'])
    expect(normalizeText(env, replacements)).toMatchInlineSnapshot(`
      "# Environment variables declared in this file are NOT automatically loaded by Prisma.
      # Please add \`import \"dotenv/config\";\` to your \`prisma7.config.ts\` file, or use the Prisma CLI with Bun
      # to load environment variables from .env files: https://pris.ly/prisma-config-env-vars.

      # Prisma supports the native connection string format for PostgreSQL, MySQL, SQLite, SQL Server, MongoDB and CockroachDB.
      # See the documentation for all the connection string options: https://pris.ly/d/connection-strings

      DATABASE_URL=\"postgresql://johndoe:randompassword@localhost:5432/mydb?schema=public\""
    `)
    expect(normalizeText(prismaConfig, replacements)).toMatchInlineSnapshot(`
      "// This file was generated by Prisma, and assumes you have installed the following:
      // npm install --save-dev @prisma/prisma7 dotenv
      import \"dotenv/config\";
      import { defineConfig } from \"@prisma/prisma7/config\";

      export default defineConfig({
        schema: \"prisma/schema.prisma\",
        migrations: {
          path: \"prisma/migrations\",
        },
        datasource: {
          url: process.env[\"DATABASE_URL\"],
        },
      });"
    `)
    expect(normalizeText(init.stderr, replacements)).toBe('')
    expect(normalizeText(init.stdout, replacements)).toMatchInlineSnapshot(`
      "
      Initialized Prisma in your project

        prisma/
          schema.prisma
        prisma7.config.ts
        .env
        .gitignore

      Next, choose how you want to set up your database:

      CONNECT EXISTING DATABASE:
        1. Configure your DATABASE_URL in prisma7.config.ts
        2. Run prisma7 db pull to introspect your database.

      CREATE NEW DATABASE:
        Local: npx prisma7 dev (runs Postgres locally in your terminal)
        Cloud: npx create-db (creates a free Prisma Postgres database)

      Then, define your models in prisma/schema.prisma and run prisma7 migrate dev to apply your schema.

      Learn more: https://pris.ly/getting-started"
    `)

    expect(combinedOutput(migrateStatus, replacements)).toContain(
      'The datasource.url property is required in your Prisma config file when using prisma7 migrate status.',
    )
    expect(combinedOutput(migrateStatus, replacements)).not.toContain('when using prisma migrate status.')

    expect(normalizeText(firstDbPush.stdout, replacements)).toContain(
      'Your database is now in sync with your Prisma schema',
    )
    expect(combinedOutput(dbPushDataLoss, replacements)).toContain(
      'Use the --accept-data-loss flag to ignore the data loss warnings like prisma7 db push --accept-data-loss',
    )
    expect(combinedOutput(dbPushDataLoss, replacements)).not.toContain(
      'Use the --accept-data-loss flag to ignore the data loss warnings like prisma db push --accept-data-loss',
    )

    expect(combinedOutput(noGenerator, replacements)).toContain('$ prisma7 generate')
    expect(combinedOutput(noGenerator, replacements)).not.toContain('$ prisma generate')

    expect(combinedOutput(noModels, replacements)).toContain('$ prisma7 generate')
    expect(combinedOutput(noModels, replacements)).not.toContain('$ prisma generate')

    expect(combinedOutput(missingClient, replacements)).toContain('rerun npx "prisma7 generate"')
    expect(combinedOutput(missingClient, replacements)).not.toContain('rerun npx "prisma generate"')

    run('pnpm', ['exec', 'tsc', '--noEmit'])
    run('pnpm', ['exec', 'prisma7', 'generate'])
    run('pnpm', ['exec', 'prisma7', 'db', 'push', '--force-reset'])
    run('pnpm', [
      'exec',
      'tsc',
      '--noEmit',
      '--module',
      'node16',
      '--moduleResolution',
      'node16',
      '--target',
      'es2022',
      'smoke.ts',
    ])
    run('tsx', ['smoke.ts'])
  } finally {
    await rm(initProjectDir, { recursive: true, force: true })
    await rm(migrateProjectDir, { recursive: true, force: true })
    await rm(dbPushProjectDir, { recursive: true, force: true })
    await rm(noGeneratorProjectDir, { recursive: true, force: true })
    await rm(noModelsProjectDir, { recursive: true, force: true })
    await rm(missingClientProjectDir, { recursive: true, force: true })
  }
}, 120_000)
