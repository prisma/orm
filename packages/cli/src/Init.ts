import fs from 'node:fs'
import path from 'node:path'

import { confirm, input, select } from '@inquirer/prompts'
import { PrismaConfigInternal } from '@prisma/config'
import type { ConnectorType } from '@prisma/generator'
import {
  arg,
  canConnectToDatabase,
  checkUnsupportedDataProxy,
  Command,
  format,
  getCommandWithExecutor,
  HelpError,
  isError,
  link,
  logger,
  PRISMA_POSTGRES_PROVIDER,
  protocolToConnectorType,
} from '@prisma/internals'
import type { operations } from '@prisma/management-api-sdk'
import dotenv from 'dotenv'
import { Schema as Shape } from 'effect'
import { bold, dim, green, red, yellow } from 'kleur/colors'
import ora from 'ora'
import { match, P } from 'ts-pattern'

import { FileWriter } from './init/file-writer'
import { isBun } from './init/is-bun'
import { printPpgInitOutput, successMessage } from './init/ppg-output'
import { installSkills } from './init/skill-install'
import { login } from './management-api/auth'
import { createAuthenticatedManagementAPI } from './management-api/auth-client'
import { FileTokenStorage } from './management-api/token-storage'
import {
  type CliDistributionIdentity,
  getCliDistributionConfigPackageName,
  getCliDistributionPackageName,
} from './utils/cli-distribution-identity'
import { determineClientOutputPath } from './utils/client-output-path'
import { printError } from './utils/prompt/utils/print'

type Region = NonNullable<operations['postV1Projects']['requestBody']>['content']['application/json']['region']

export const defaultSchema = (props?: {
  datasourceProvider?: ConnectorType
  generatorProvider?: string
  previewFeatures?: string[]
  output?: string
  withModel?: boolean
}) => {
  const {
    datasourceProvider = 'postgresql',
    generatorProvider = defaultGeneratorProvider,
    previewFeatures = defaultPreviewFeatures,
    output = '../generated/prisma',
    withModel = false,
  } = props ?? {}

  let schema = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

// Get a free hosted Postgres database in seconds: \`npx create-db\`

generator client {
  provider = "${generatorProvider}"
${
  previewFeatures.length > 0
    ? `  previewFeatures = [${previewFeatures.map((feature) => `"${feature}"`).join(', ')}]\n`
    : ''
}  output   = "${output}"
}

datasource db {
  provider = "${datasourceProvider}"
}
`

  // We add a model to the schema file if the user passed the --with-model flag
  if (withModel) {
    const defaultAttributes = `email String  @unique
  name  String?`

    switch (datasourceProvider) {
      case 'mongodb':
        schema += `
model User {
  id    String  @id @default(auto()) @map("_id") @db.ObjectId
  ${defaultAttributes}
}
`
        break
      case 'cockroachdb':
        schema += `
model User {
  id    BigInt  @id @default(sequence())
  ${defaultAttributes}
}
`
        break
      default:
        schema += `
model User {
  id    Int     @id @default(autoincrement())
  ${defaultAttributes}
}
`
    }
  }

  return schema
}

export const defaultEnv = async (
  url: string | undefined,
  debug = false,
  comments = true,
  identity: CliDistributionIdentity,
) => {
  if (url === undefined) {
    // TODO: bundle the CLI to ESM instead of CommonJS and make these module-level imports
    const [{ startPrismaDevServer }, { ServerState }] = await Promise.all([
      import('@prisma/dev'),
      import('@prisma/dev/internal/state'),
    ])

    let created = false
    const state =
      (await ServerState.fromServerDump({ debug })) ||
      ((created = true), await ServerState.createExclusively({ debug, persistenceMode: 'stateful' }))

    if (created) {
      await state.close()
    }

    const server = await startPrismaDevServer({
      databasePort: state.databasePort,
      dryRun: true,
      name: state.name,
      persistenceMode: 'stateful',
      port: state.port,
      shadowDatabasePort: state.shadowDatabasePort,
      debug,
    })

    url = server.ppg.url
  }

  let env = comments
    ? `# Environment variables declared in this file are NOT automatically loaded by Prisma.
# Please add \`import "dotenv/config";\` to your \`prisma7.config.ts\` file, or use the Prisma CLI with Bun
# to load environment variables from .env files: https://pris.ly/prisma-config-env-vars.

# Prisma supports the native connection string format for PostgreSQL, MySQL, SQLite, SQL Server, MongoDB and CockroachDB.
# See the documentation for all the connection string options: https://pris.ly/d/connection-strings

${
  url.startsWith('prisma+postgres:') && url.includes('localhost')
    ? `# The following \`prisma+postgres\` URL is similar to the URL produced by running a local Prisma Postgres
# server with the \`${identity} dev\` CLI command, when not choosing any non-default ports or settings. The API key, unlike the
# one found in a remote Prisma Postgres URL, does not contain any sensitive information.\n\n`
    : ''
}`
    : ''
  env += `DATABASE_URL="${url}"`
  return env
}

export const defaultPort = (datasourceProvider: ConnectorType) => {
  switch (datasourceProvider) {
    case 'mysql':
      return 3306
    case 'sqlserver':
      return 1433
    case 'mongodb':
      return 27017
    case 'postgresql':
      return 5432
    case 'cockroachdb':
      return 26257
    case PRISMA_POSTGRES_PROVIDER:
      return null
  }

  return undefined
}

export const defaultURL = (
  datasourceProvider: ConnectorType,
  port = defaultPort(datasourceProvider),
  schema = 'public',
) => {
  switch (datasourceProvider) {
    case 'postgresql':
      return `postgresql://johndoe:randompassword@localhost:${port}/mydb?schema=${schema}`
    case 'cockroachdb':
      return `postgresql://johndoe:randompassword@localhost:${port}/mydb?schema=${schema}`
    case 'mysql':
      return `mysql://johndoe:randompassword@localhost:${port}/mydb`
    case 'sqlserver':
      return `sqlserver://localhost:${port};database=mydb;user=SA;password=randompassword;`
    case 'mongodb':
      return `mongodb+srv://root:randompassword@cluster0.ab1cd.mongodb.net/mydb?retryWrites=true&w=majority`
    case 'sqlite':
      return 'file:./dev.db'
    default:
      return undefined
  }
}

const defaultGitIgnore = () => {
  return `node_modules
# Keep environment variables out of version control
.env
`
}

export const defaultGeneratorProvider = 'prisma-client'

export const defaultPreviewFeatures = []

function normalizePath(configPath: string) {
  return JSON.stringify(configPath.replaceAll(path.sep, '/'))
}

type DefaultConfigInput = {
  /**
   * The path to the `prisma` folder.
   */
  prismaFolder: string
  /**
   * The runtime to use.
   * Currently, this is only used to customize the Bun experience.
   */
  runtime: 'bun' | 'other'
  identity: CliDistributionIdentity
}

export const defaultConfig = ({ prismaFolder, runtime, identity }: DefaultConfigInput) => {
  const configPackage = getCliDistributionConfigPackageName(identity)
  const packageName = getCliDistributionPackageName(identity)
  const schemaPath = path.relative(process.cwd(), path.join(prismaFolder, 'schema.prisma'))
  const migrationsPath = path.relative(process.cwd(), path.join(prismaFolder, 'migrations'))

  const configSrc = match({ runtime })
    .with({ runtime: 'bun' }, () => {
      return `\
// This file was generated by Prisma, and assumes you run Prisma commands using \`bun --bun run ${identity} [command]\`.
import { defineConfig, env } from "${configPackage}";

export default defineConfig({
  schema: ${normalizePath(schemaPath)},
  migrations: {
    path: ${normalizePath(migrationsPath)},
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
`
    })
    .otherwise(() => {
      return `\
// This file was generated by Prisma, and assumes you have installed the following:
// npm install --save-dev ${packageName} dotenv
import "dotenv/config";
import { defineConfig } from "${configPackage}";

export default defineConfig({
  schema: ${normalizePath(schemaPath)},
  migrations: {
    path: ${normalizePath(migrationsPath)},
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
`
    })

  return configSrc
}

export class Init implements Command {
  static new(identity: CliDistributionIdentity): Init {
    return new Init(identity)
  }

  constructor(private readonly identity: CliDistributionIdentity) {}

  async parse(argv: string[], _config: PrismaConfigInternal): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--url': String,
      '--datasource-provider': String,
      '--generator-provider': String,
      '--preview-feature': [String],
      '--output': String,
      '--with-model': Boolean,
      '--no-skills': Boolean,
      '--db': Boolean,
      '--region': String,
      '--name': String,
      '--non-interactive': Boolean,
      '--prompt': String,
      '--vibe': String,
      '--debug': Boolean,
    })

    if (isError(args) || args['--help']) {
      return this.help()
    }

    const urlArg = args['--url']

    if (urlArg) {
      checkUnsupportedDataProxy({
        command: `${this.identity} init`,
        validatedConfig: { datasource: { url: urlArg } },
      })
    }

    /**
     * Validation
     */

    const outputDirName = args._[0]
    if (outputDirName) {
      throw Error('The init command does not take any argument.')
    }

    const { datasourceProvider, url } = await match(args)
      .with(
        {
          '--datasource-provider': P.when((datasourceProvider): datasourceProvider is string =>
            Boolean(datasourceProvider),
          ),
        },
        (input) => {
          const datasourceProvider = input['--datasource-provider'].toLowerCase()

          assertDatasourceProvider(datasourceProvider)

          const url = defaultURL(datasourceProvider)

          return { datasourceProvider, url }
        },
      )
      .with(
        {
          '--url': P.when((url): url is string => Boolean(url)),
        },
        async (input) => {
          const url = input['--url']
          const canConnect = await canConnectToDatabase(url)
          if (canConnect !== true) {
            const { code, message } = canConnect

            // P1003 means that the db doesn't exist but we can connect
            if (code !== 'P1003') {
              if (code) {
                throw new Error(`${code}: ${message}`)
              } else {
                throw new Error(message)
              }
            }
          }

          const datasourceProvider = protocolToConnectorType(`${url.split(':')[0]}:`)
          return { datasourceProvider, url }
        },
      )
      .otherwise(() => {
        return {
          datasourceProvider: 'postgresql' as const,
          url: undefined,
        }
      })
    const generatorProvider = args['--generator-provider']
    const previewFeatures = args['--preview-feature']
    const output = args['--output']
    const isPpgCommand =
      args['--db'] || datasourceProvider === PRISMA_POSTGRES_PROVIDER || args['--prompt'] || args['--vibe']

    if (args['--debug']) {
      console.log(`[isBun]`, isBun)
    }

    let prismaPostgresDatabaseUrl: string | undefined
    let workspaceId: string | undefined
    let projectId: string | undefined
    let environmentId: string | undefined

    const outputDir = process.cwd()
    const prismaFolder = path.join(outputDir, 'prisma')

    const writer = new FileWriter(outputDir)

    let generatedSchema: string | undefined
    let generatedName: string | undefined

    if (isPpgCommand) {
      const tokenStorage = new FileTokenStorage()
      const tokens = await tokenStorage.getTokens()

      if (!tokens) {
        if (args['--non-interactive']) {
          return 'Please authenticate before creating a Prisma Postgres project.'
        }
        console.log('This will create a project for you on console.prisma.io and requires you to be authenticated.')
        const authAnswer = await confirm({
          message: 'Would you like to authenticate?',
        })
        if (!authAnswer) {
          return 'Project creation aborted. You need to authenticate to use Prisma Postgres'
        }
        await login({ utmMedium: 'command-init-db' })
      }

      if (args['--prompt'] || args['--vibe']) {
        const prompt = args['--prompt'] || args['--vibe'] || ''
        const spinner = ora(`Generating a Prisma Schema based on your description ${bold(prompt)} ...`).start()

        try {
          const serverResponseShape = Shape.Struct({
            generatedSchema: Shape.String,
            generatedName: Shape.String,
          })

          ;({ generatedSchema, generatedName } = Shape.decodeUnknownSync(serverResponseShape)(
            await (
              await fetch(`https://prisma-generate-server.prisma.workers.dev/`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  description: prompt,
                }),
              })
            ).json(),
          ))
        } catch (e) {
          spinner.fail()
          throw e
        }

        spinner.succeed('Schema is ready')
      }

      console.log("Let's set up your Prisma Postgres database!")

      const managementAPI = createAuthenticatedManagementAPI()
      const client = managementAPI.client

      const { data: regionsData, error: regionsError } = await client.GET('/v1/regions/postgres')
      if (regionsError) {
        const errorMessage = regionsError.error?.message
        throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Failed to fetch regions')
      }
      if (!regionsData) {
        throw new Error('No regions data returned')
      }
      const regions = regionsData.data

      const ppgRegionSelection =
        (args['--region'] as Region) ||
        (await select({
          message: 'Select your region:',
          default: 'us-east-1',
          choices: regions.map((region) => ({
            name: `${region.id} - ${region.name}`,
            value: region.id as Region,
            disabled: region.status !== 'available',
          })),
          loop: true,
        }))

      const projectDisplayNameAnswer =
        args['--name'] ||
        (await input({
          message: 'Enter a project name:',
          default: generatedName || 'My Prisma Project',
        }))

      const spinner = ora(`Creating project ${bold(projectDisplayNameAnswer)} (this may take a few seconds)...`).start()

      try {
        const { data: projectData, error: projectError } = await client.POST('/v1/projects', {
          body: {
            createDatabase: true,
            name: projectDisplayNameAnswer,
            region: ppgRegionSelection,
          },
        })

        if (projectError) {
          const errorMessage = projectError.error?.message
          throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Failed to create project')
        }
        if (!projectData) {
          throw new Error('No project data returned')
        }

        const project = projectData.data

        if (!project.database) {
          // This should never happen: `database` should only be `null` when
          // the request body has `createDatabase: false`.
          throw new Error('Missing database info in response')
        }

        const connection = project.database.connections?.find(
          (c) => Boolean(c.endpoints?.direct?.connectionString) || Boolean(c.endpoints?.pooled?.connectionString),
        )

        const connectionString =
          connection?.endpoints?.direct?.connectionString ?? connection?.endpoints?.pooled?.connectionString

        if (!connectionString) {
          throw new Error('Missing connection string in response')
        }

        prismaPostgresDatabaseUrl = connectionString

        workspaceId = project.workspace.id.replace(/^wksp_/, '')
        projectId = project.id.replace(/^proj_/, '')
        environmentId = project.database.id.replace(/^db_/, '')

        spinner.succeed(successMessage('Your Prisma Postgres database is ready ✅'))
      } catch (error) {
        spinner.fail(error instanceof Error ? error.message : 'Something went wrong')
        throw error
      }
    }

    if (
      fs.existsSync(path.join(outputDir, 'schema.prisma')) ||
      fs.existsSync(prismaFolder) ||
      fs.existsSync(path.join(prismaFolder, 'schema.prisma'))
    ) {
      if (isPpgCommand) {
        return printPpgInitOutput({
          databaseUrl: prismaPostgresDatabaseUrl!,
          workspaceId: workspaceId!,
          projectId: projectId!,
          environmentId,
          isExistingPrismaProject: true,
          identity: this.identity,
        })
      }
    }

    if (fs.existsSync(path.join(outputDir, 'schema.prisma'))) {
      console.log(
        printError(`File ${bold('schema.prisma')} already exists in your project.
        Please try again in a project that is not yet using Prisma.
      `),
      )
      process.exit(1)
    }

    if (fs.existsSync(prismaFolder)) {
      console.log(
        printError(`A folder called ${bold('prisma')} already exists in your project.
        Please try again in a project that is not yet using Prisma.
      `),
      )
      process.exit(1)
    }

    if (fs.existsSync(path.join(prismaFolder, 'schema.prisma'))) {
      console.log(
        printError(`File ${bold('prisma/schema.prisma')} already exists in your project.
        Please try again in a project that is not yet using Prisma.
      `),
      )
      process.exit(1)
    }

    /**
     * Validation successful? Let's create everything!
     */

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir)
    }

    if (!fs.existsSync(prismaFolder)) {
      fs.mkdirSync(prismaFolder)
    }

    const clientOutput = output ?? determineClientOutputPath(prismaFolder)

    writer.write(
      path.join(prismaFolder, 'schema.prisma'),
      generatedSchema ||
        defaultSchema({
          datasourceProvider,
          generatorProvider,
          previewFeatures,
          output: clientOutput,
          withModel: args['--with-model'],
        }),
    )

    const databaseUrl = prismaPostgresDatabaseUrl || url
    const warnings: string[] = []

    writer.write(
      path.join(outputDir, 'prisma7.config.ts'),
      defaultConfig({
        prismaFolder,
        runtime: isBun ? 'bun' : 'other',
        identity: this.identity,
      }),
    )

    const envPath = path.join(outputDir, '.env')
    if (!fs.existsSync(envPath)) {
      writer.write(envPath, await defaultEnv(databaseUrl, args['--debug'], true, this.identity))
    } else {
      const envFile = fs.readFileSync(envPath, { encoding: 'utf8' })
      const config = dotenv.parse(envFile) // will return an object
      if (Object.keys(config).includes('DATABASE_URL')) {
        warnings.push(
          `${yellow('warn')} Prisma would have added DATABASE_URL but it already exists in ${bold(
            path.relative(outputDir, envPath),
          )}.`,
        )
      } else {
        fs.appendFileSync(
          envPath,
          `\n\n` +
            `# This was inserted by \`${this.identity} init\`:\n` +
            (await defaultEnv(databaseUrl, args['--debug'], true, this.identity)),
        )
      }
    }

    const gitignorePath = path.join(outputDir, '.gitignore')
    try {
      writer.write(gitignorePath, defaultGitIgnore(), { flag: 'wx' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        warnings.push(
          `${yellow(
            'warn',
          )} You already have a ${bold('.gitignore')} file. Don't forget to add ${bold('.env')} in it to not commit any private information.`,
        )
      } else {
        console.error('Failed to write .gitignore file, reason: ', e)
      }
    }

    // Append the generated client to the .gitignore file regardless of whether we created it
    // in the previous step.
    const clientPathRelativeToOutputDir = path.relative(outputDir, path.resolve(prismaFolder, clientOutput))
    try {
      fs.appendFileSync(gitignorePath, `\n/${clientPathRelativeToOutputDir.replaceAll(path.sep, '/')}\n`)
    } catch (e) {
      console.error('Failed to append client path to .gitignore file, reason: ', e)
    }

    let skillsInstalled = false
    if (!args['--no-skills']) {
      const skillsSpinner = ora('Installing skills').start()
      const skillsResult = await installSkills({ cwd: outputDir })
      if (skillsResult.ok) {
        skillsSpinner.succeed('Skills installed')
        skillsInstalled = true
      } else {
        skillsSpinner.fail('Skills install failed')
        console.warn(
          `${yellow('warn')} Failed to install Prisma agent skills. You can install them manually by running:\n  ${
            skillsResult.manualCommand
          }`,
        )
      }
    }

    const cliCommand = this.identity
    const connectExistingDatabaseSteps = `\
  1. Configure your DATABASE_URL in ${green('prisma7.config.ts')}
  2. Run ${green(getCommandWithExecutor(`${cliCommand} db pull`))} to introspect your database.`

    const postgresProviders: ConnectorType[] = ['postgres', 'postgresql', 'prisma+postgres']

    let setupDatabaseSection: string
    if (postgresProviders.includes(datasourceProvider)) {
      setupDatabaseSection = `\
Next, choose how you want to set up your database:

CONNECT EXISTING DATABASE:
${connectExistingDatabaseSteps}

CREATE NEW DATABASE:
  Local: ${green(`npx ${cliCommand} dev`)} (runs Postgres locally in your terminal)
  Cloud: ${green('npx create-db')} (creates a free Prisma Postgres database)`
    } else {
      setupDatabaseSection = `\
Next, set up your database:
${connectExistingDatabaseSteps}`
    }

    const skillsSummary = skillsInstalled
      ? '\n  .claude/skills/\n  .windsurf/skills/\n  .agents/skills/\n  skills-lock.json'
      : ''

    const defaultOutput = `
Initialized Prisma in your project

${writer.format({
  level: 0,
  printHeadersFromLevel: 1,
  indentSize: 2,
})}${skillsSummary}
${warnings.length > 0 && logger.should.warn() ? `\n${warnings.join('\n')}\n` : ''}
${setupDatabaseSection}

Then, define your models in ${green('prisma/schema.prisma')} and run ${green(getCommandWithExecutor(`${cliCommand} migrate dev`))} to apply your schema.

Learn more: ${link('https://pris.ly/getting-started')}
 `

    return isPpgCommand
      ? printPpgInitOutput({
          databaseUrl: prismaPostgresDatabaseUrl!,
          workspaceId: workspaceId!,
          projectId: projectId!,
          environmentId,
          identity: this.identity,
        })
      : defaultOutput
  }

  // help message
  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${createHelp(this.identity)}`)
    }
    return createHelp(this.identity)
  }
}

function createHelp(identity: CliDistributionIdentity): string {
  return format(`
  Set up a new Prisma project

  ${bold('Usage')}

    ${dim('$')} ${identity} init [options]

  ${bold('Options')}

             -h, --help   Display this help message
                   --db   Provisions a fully managed Prisma Postgres database on the Prisma Data Platform.
  --datasource-provider   Define the datasource provider to use: postgresql, mysql, sqlite, sqlserver, mongodb or cockroachdb
   --generator-provider   Define the generator provider to use. Default: \`prisma-client\`
      --preview-feature   Define a preview feature to use.
               --output   Define Prisma Client generator output path to use.
                  --url   Define a custom datasource url

  ${bold('Flags')}

           --with-model   Add example model to created schema file
            --no-skills   Skip installing Prisma agent skills

  ${bold('Examples')}

  Set up a new \`${identity} dev\`-ready (local Prisma Postgres) Prisma project
    ${dim('$')} ${identity} init

  Set up a new Prisma project and specify MySQL as the datasource provider to use
    ${dim('$')} ${identity} init --datasource-provider mysql

  Set up a new \`${identity} dev\`-ready (local Prisma Postgres) Prisma project and specify \`prisma-client\` as the generator provider to use
    ${dim('$')} ${identity} init --generator-provider prisma-client

  Set up a new \`${identity} dev\`-ready (local Prisma Postgres) Prisma project and specify \`x\` and \`y\` as the preview features to use
    ${dim('$')} ${identity} init --preview-feature x --preview-feature y

  Set up a new \`${identity} dev\`-ready (local Prisma Postgres) Prisma project and specify \`./generated-client\` as the output path to use
    ${dim('$')} ${identity} init --output ./generated-client

  Set up a new Prisma project and specify the url that will be used
    ${dim('$')} ${identity} init --url mysql://user:password@localhost:3306/mydb

  Set up a new \`${identity} dev\`-ready (local Prisma Postgres) Prisma project with an example model
    ${dim('$')} ${identity} init --with-model
  `)
}

// order matters for the error message.
const DATASOURCE_PROVIDERS = [
  'postgresql',
  'mysql',
  'sqlite',
  'sqlserver',
  'mongodb',
  'cockroachdb',
  'prismapostgres',
  'prisma+postgres',
] as const

function assertDatasourceProvider(thing: unknown): asserts thing is ConnectorType {
  if (typeof thing !== 'string' || !DATASOURCE_PROVIDERS.includes(thing as never)) {
    throw new Error(
      `Provider "${thing}" is invalid or not supported. Try again with ${DATASOURCE_PROVIDERS.slice(0, -1)
        .map((p) => `"${p}"`)
        .join(', ')} or "${DATASOURCE_PROVIDERS.at(-1)}".`,
    )
  }
}
