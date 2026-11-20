import type { PrismaConfigInternal } from '@prisma/config'
import Debug from '@prisma/debug'
import {
  arg,
  checkUnsupportedDataProxy,
  Command,
  createSchemaPathInput,
  format,
  formatms,
  getCommandWithExecutor,
  getConfig,
  getSchemaDatasourceProvider,
  HelpError,
  inferDirectoryConfig,
  link,
  loadSchemaContext,
  MigrateTypes,
  printSchemaLoadedMessage,
  relativizePathInPSLError,
  toSchemasContainer,
  validatePrismaConfigWithDatasource,
} from '@prisma/internals'
import { bold, dim, green, italic, red, underline, yellow } from 'kleur/colors'
import path from 'path'

import { Migrate } from '../Migrate'
import type { EngineArgs } from '../types'
import { countModelsAndTypes } from '../utils/countModelsAndTypes'
import { parseDatasourceInfo } from '../utils/ensureDatabaseExists'
import { NoSchemaFoundError } from '../utils/errors'
import { isSchemaEmpty } from '../utils/isSchemaEmpty'
import { printDatasource } from '../utils/printDatasource'
import { printIntrospectedSchema } from '../utils/printIntrospectedSchema'
import { removeSchemaFiles } from '../utils/removeSchemaFiles'
import { saveSchemaFiles } from '../utils/saveSchemaFiles'
import { createSpinner } from '../utils/spinner'

const debug = Debug('prisma:db:pull')

function renderHelp(cliCommand: string): string {
  return format(`
Pull the state from the database to the Prisma schema using introspection

${bold('Usage')}

  ${dim('$')} ${cliCommand} db pull [flags/options]

  The datasource URL configuration is read from the Prisma config file (e.g., ${italic('prisma7.config.ts')}).

${bold('Flags')}

              -h, --help   Display this help message
                 --force   Ignore current Prisma schema file
                 --print   Print the introspected Prisma schema to stdout

${bold('Options')}

                --config   Custom path to your Prisma config file
                --schema   Custom path to your Prisma schema
                 --url     Override the datasource URL from the Prisma config file
  --composite-type-depth   Specify the depth for introspecting composite types (e.g. Embedded Documents in MongoDB)
                           Number, default is -1 for infinite depth, 0 = off
               --schemas   Specify the database schemas to introspect. This overrides the schemas defined in the datasource block of your Prisma schema.
              --local-d1   Generate a Prisma schema from a local Cloudflare D1 database
${bold('Examples')}

With an existing Prisma schema
  ${dim('$')} ${cliCommand} db pull

Or specify a Prisma schema path
  ${dim('$')} ${cliCommand} db pull --schema=./schema.prisma

Instead of saving the result to the filesystem, you can also print it to stdout
  ${dim('$')} ${cliCommand} db pull --print

Overwrite the current schema with the introspected schema instead of enriching it
  ${dim('$')} ${cliCommand} db pull --force

Set composite types introspection depth to 2 levels
  ${dim('$')} ${cliCommand} db pull --composite-type-depth=2

`)
}

export class DbPull implements Command {
  public static new(cliCommand: string): DbPull {
    return new DbPull(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(
    argv: string[],
    config: PrismaConfigInternal,
    baseDir: string = process.cwd(),
  ): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--print': Boolean,
      '--schema': String,
      '--config': String,
      '--schemas': String,
      '--force': Boolean,
      '--composite-type-depth': Number, // optional, only on mongodb
      '--url': String,
    })

    const spinnerFactory = createSpinner(!args['--print'])

    if (args instanceof Error) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const schemaContext = await loadSchemaContext({
      schemaPath: createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
      printLoadMessage: false,
      allowNull: true,
    })

    let cmdSpecificConfig = config
    if (args['--url']) {
      cmdSpecificConfig = {
        ...cmdSpecificConfig,
        datasource: {
          ...cmdSpecificConfig.datasource,
          url: args['--url'],
        },
      }
    }

    const cmd = `${this.cliCommand} db pull`
    const validatedConfig = validatePrismaConfigWithDatasource({ config: cmdSpecificConfig, command: cmd })

    checkUnsupportedDataProxy({ command: cmd, validatedConfig })

    // Print to console if --print is not passed to only have the schema in stdout
    if (schemaContext && !args['--print']) {
      printSchemaLoadedMessage(schemaContext.loadedFromPathForLogMessages)

      printDatasource({ datasourceInfo: parseDatasourceInfo(schemaContext?.primaryDatasource, validatedConfig) })
    }

    if (!schemaContext) {
      throw new NoSchemaFoundError()
    }

    getSchemaDatasourceProvider(schemaContext)

    const firstDatasource = schemaContext.primaryDatasource
    const schema = schemaContext.schemaFiles

    await getConfig({
      datamodel: schema,
    })

    // Re-Introspection is not supported on MongoDB
    const modelRegex = /\s*model\s*(\w+)\s*{/
    const isReintrospection = schema.some(([_, schema]) => !!modelRegex.exec(schema as string))

    if (isReintrospection && !args['--force'] && firstDatasource?.provider === 'mongodb') {
      throw new Error(`Iterating on one schema using re-introspection with db pull is currently not supported with MongoDB provider.
You can explicitly ignore and override your current local schema file with ${green(
        getCommandWithExecutor(`${this.cliCommand} db pull --force`),
      )}
Some information will be lost (relations, comments, mapped fields, @ignore...), follow ${link(
        'https://github.com/prisma/prisma/issues/9585',
      )} for more info.`)
    }

    const migrate = await Migrate.setup({
      schemaEngineConfig: cmdSpecificConfig,
      baseDir,
      schemaContext,
      extensions: cmdSpecificConfig['extensions'],
    })

    const engine = migrate.engine
    const basedOn = firstDatasource
      ? ` based on datasource defined in ${underline(schemaContext.loadedFromPathForLogMessages)}`
      : ''
    const introspectionSpinner = spinnerFactory(`Introspecting${basedOn}`)

    const before = Math.round(performance.now())
    let introspectionSchema: MigrateTypes.SchemasContainer | undefined = undefined
    let introspectionWarnings: EngineArgs.IntrospectResult['warnings']
    try {
      const directoryConfig = inferDirectoryConfig(schemaContext, cmdSpecificConfig)
      const introspectionResult = await engine.introspect({
        schema: toSchemasContainer(schema),
        baseDirectoryPath: schemaContext?.schemaRootDir ?? process.cwd(),
        viewsDirectoryPath: directoryConfig.viewsDirPath,
        force: args['--force'],
        compositeTypeDepth: args['--composite-type-depth'],
        namespaces: args['--schemas']?.split(','),
      })

      introspectionSchema = introspectionResult.schema
      introspectionWarnings = introspectionResult.warnings
      debug(`Introspection warnings`, introspectionWarnings)
    } catch (e: any) {
      introspectionSpinner.failure()

      /**
       * Human-friendly error handling based on:
       * https://www.prisma.io/docs/reference/api-reference/error-reference
       */

      if (e.code === 'P4001' && isSchemaEmpty(introspectionSchema)) {
        /* P4001: The introspected database was empty */
        throw new Error(`\n${red(bold(`${e.code} `))}${red('The introspected database was empty:')}

${bold(`${this.cliCommand} db pull`)} could not create any models in your ${bold(
          'schema.prisma',
        )} file and you will not be able to generate Prisma Client with the ${bold(
          getCommandWithExecutor(`${this.cliCommand} generate`),
        )} command.

${bold('To fix this, you have two options:')}

- manually create a table in your database.
- make sure the database connection URL inside the ${bold('datasource')} block in ${bold(
          'schema.prisma',
        )} points to a database that is not empty (it must contain at least one table).

Then you can run ${green(getCommandWithExecutor(`${this.cliCommand} db pull`))} again.
`)
      } else if (e.code === 'P1003') {
        /* P1003: Database does not exist */
        throw new Error(`\n${red(bold(`${e.code} `))}${red('The introspected database does not exist:')}

${bold(`${this.cliCommand} db pull`)} could not create any models in your ${bold(
          'schema.prisma',
        )} file and you will not be able to generate Prisma Client with the ${bold(
          getCommandWithExecutor(`${this.cliCommand} generate`),
        )} command.

${bold('To fix this, you have two options:')}

- manually create a database.
- make sure the database connection URL inside the ${bold('datasource')} block in ${bold(
          'schema.prisma',
        )} points to an existing database.

Then you can run ${green(getCommandWithExecutor(`${this.cliCommand} db pull`))} again.
`)
      } else if (e.code === 'P1012') {
        /* P1012: Schema parsing error */
        process.stdout.write('\n') // empty line

        const message = relativizePathInPSLError(e.message)

        throw new Error(`${red(message)}
Introspection failed as your current Prisma schema file is invalid

Please fix your current schema manually (using either ${green(
          getCommandWithExecutor(`${this.cliCommand} validate`),
        )} or the Prisma VS Code extension to understand what's broken and confirm you fixed it), and then run this command again.
Or run this command with the ${green(
          '--force',
        )} flag to ignore your current schema and overwrite it. All local modifications will be lost.\n`)
      }

      process.stdout.write('\n') // empty line
      throw e
    }

    const introspectionWarningsMessage = this.getWarningMessage(introspectionWarnings)

    if (args['--print']) {
      printIntrospectedSchema(introspectionSchema, process.stdout)

      if (introspectionWarningsMessage.trim().length > 0) {
        // Replace make it a // comment block
        console.error(introspectionWarningsMessage.replace(/(\n)/gm, '\n// '))
      }
    } else {
      if (args['--force']) {
        await removeSchemaFiles(schema)
      }
      await saveSchemaFiles(introspectionSchema)

      const { modelsCount, typesCount } = countModelsAndTypes(introspectionSchema)

      const modelsCountMessage = `${modelsCount} ${modelsCount > 1 ? 'models' : 'model'}`
      const typesCountMessage = `${typesCount} ${typesCount > 1 ? 'embedded documents' : 'embedded document'}`
      let modelsAndTypesMessage: string
      if (typesCount > 0) {
        modelsAndTypesMessage = `${modelsCountMessage} and ${typesCountMessage}`
      } else {
        modelsAndTypesMessage = `${modelsCountMessage}`
      }
      const modelsAndTypesCountMessage =
        modelsCount + typesCount > 1
          ? `${modelsAndTypesMessage} and wrote them`
          : `${modelsAndTypesMessage} and wrote it`

      const introspectedSchemaPath = schemaContext?.loadedFromPathForLogMessages || introspectionSchema.files[0].path
      introspectionSpinner.success(`Introspected ${modelsAndTypesCountMessage} into ${underline(
        path.relative(process.cwd(), introspectedSchemaPath),
      )} in ${bold(formatms(Math.round(performance.now()) - before))}
      ${yellow(introspectionWarningsMessage)}
${`Run ${green(getCommandWithExecutor(`${this.cliCommand} generate`))} to generate Prisma Client.`}`)
    }

    return ''
  }

  private getWarningMessage(warnings: EngineArgs.IntrospectResult['warnings']): string {
    if (warnings) {
      return `\n${warnings}`
    }

    return ''
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${renderHelp(this.cliCommand)}`)
    }
    return renderHelp(this.cliCommand)
  }
}
