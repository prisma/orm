import type { PrismaConfigInternal } from '@prisma/config'
import Debug from '@prisma/debug'
import {
  arg,
  Command,
  createSchemaPathInput,
  format,
  getSchemaWithPath,
  HelpError,
  isError,
  link,
  loadSchemaContext,
  MigrateTypes,
  toSchemasContainer,
  toSchemasWithConfigDir,
} from '@prisma/internals'
import fs from 'fs-jetpack'
import { bold, dim, green, italic } from 'kleur/colors'
import path from 'path'

import { Migrate } from '../Migrate'
import type { EngineArgs, EngineResults } from '../types'
import { CaptureStdout } from '../utils/captureStdout'
import { listMigrations } from '../utils/listMigrations'

const debug = Debug('prisma:migrate:diff')

function renderHelpOptions(cliCommand: string): string {
  return format(
    `${bold('Usage')}

  ${dim('$')} ${cliCommand} migrate diff [options]

${bold('Options')}

  -h, --help               Display this help message
  --config                 Custom path to your Prisma config file
  -o, --output             Writes to a file instead of stdout

${italic('From and To inputs (1 `--from-...` and 1 `--to-...` must be provided):')}
  --from-empty             Flag to assume from or to is an empty datamodel
  --to-empty

  --from-schema            Path to a Prisma schema file, uses the ${italic('datamodel')} for the diff
  --to-schema

  --from-migrations        Path to the Prisma Migrate migrations directory
  --to-migrations

  --from-config-datasource Flag to use the datasource from the Prisma config file
  --to-config-datasource

${bold('Flags')}

  --script                 Render a SQL script to stdout instead of the default human readable summary (not supported on MongoDB)
  --exit-code              Change the exit code behavior to signal if the diff is empty or not (Empty: 0, Error: 1, Not empty: 2). Default behavior is Success: 0, Error: 1.`,
  )
}

function renderHelp(cliCommand: string): string {
  return format(`
${
  process.platform === 'win32' ? '' : '🔍 '
}Compares the database schema from two arbitrary sources, and outputs the differences either as a human-readable summary (by default) or an executable script.

${green(`${cliCommand} migrate diff`)} is a read-only command that does not write to your datasource(s).
${green(`${cliCommand} db execute`)} can be used to execute its ${green(`--script`)} output.

The command takes a source ${green(`--from-...`)} and a destination ${green(`--to-...`)}.
The source and destination must use the same provider,
e.g. a diff using 2 different providers like PostgreSQL and SQLite is not supported.

It compares the source with the destination to generate a diff.
The diff can be interpreted as generating a migration that brings the source schema (from) to the shape of the destination schema (to).
The default output is a human readable diff, it can be rendered as SQL using \`--script\` on SQL databases.

See the documentation for more information ${link('https://pris.ly/d/migrate-diff')}

${renderHelpOptions(cliCommand)}
${bold('Examples')}

  From the configured database to a Prisma datamodel
    e.g. roll forward after a migration failed in the middle
  ${dim('$')} ${cliCommand} migrate diff \\
    --from-config-datasource \\
    --to-schema=next_datamodel.prisma \\
    --script

  From a Prisma datamodel to the configured database
    e.g. roll forward after a migration failed in the middle
  ${dim('$')} ${cliCommand} migrate diff \\
    --from-schema=next_datamodel.prisma \\
    --to-config-datasource \\
    --script

  From a Prisma Migrate \`migrations\` directory to the configured database
    e.g. generate a migration for a hotfix already applied on production
  ${dim('$')} ${cliCommand} migrate diff \\
    --from-migrations ./migrations \\
    --to-config-datasource \\
    --script

  Execute the --script output with \`${cliCommand} db execute\` using bash pipe \`|\`
  ${dim('$')} ${cliCommand} migrate diff \\
    --from-[...] \\
    --to-[...] \\
    --script | ${cliCommand} db execute --stdin --url="$DATABASE_URL"

  Detect if both sources are in sync, it will exit with exit code 2 if changes are detected
  ${dim('$')} ${cliCommand} migrate diff \\
    --exit-code \\
    --from-[...] \\
    --to-[...]
`)
}

export class MigrateDiff implements Command {
  public static new(cliCommand: string): MigrateDiff {
    return new MigrateDiff(cliCommand)
  }

  private constructor(private readonly cliCommand: string) {}

  public async parse(argv: string[], config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(
      argv,
      {
        '--help': Boolean,
        '-h': '--help',
        '--output': String,
        '-o': '--output',
        // From
        '--from-empty': Boolean,
        '--from-config-datasource': Boolean,
        '--from-schema': String,
        '--from-migrations': String,
        // To
        '--to-empty': Boolean,
        '--to-config-datasource': Boolean,
        '--to-schema': String,
        '--to-migrations': String,
        // Others
        '--script': Boolean,
        '--exit-code': Boolean,
        '--telemetry-information': String,
        '--config': String,
        // Removed, but parsed to show help error
        '--from-url': String,
        '--to-url': String,
        '--from-schema-datasource': String,
        '--to-schema-datasource': String,
        '--from-schema-datamodel': String,
        '--to-schema-datamodel': String,
        '--from-local-d1': Boolean,
        '--to-local-d1': Boolean,
      },
      false,
    )

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const removedTargetParameterHint = Object.keys(args)
      .map(getRemovedTargetParameterHint)
      .find((msg) => msg !== undefined)
    if (removedTargetParameterHint) {
      return this.help(removedTargetParameterHint)
    }

    const numberOfFromParameterProvided =
      Number(Boolean(args['--from-empty'])) +
      Number(Boolean(args['--from-config-datasource'])) +
      Number(Boolean(args['--from-schema'])) +
      Number(Boolean(args['--from-migrations']))

    const numberOfToParameterProvided =
      Number(Boolean(args['--to-empty'])) +
      Number(Boolean(args['--to-config-datasource'])) +
      Number(Boolean(args['--to-schema'])) +
      Number(Boolean(args['--to-migrations']))

    // One of --to or --from is required
    if (numberOfFromParameterProvided !== 1 || numberOfToParameterProvided !== 1) {
      const errorMessages: string[] = []
      if (numberOfFromParameterProvided !== 1) {
        errorMessages.push(`${numberOfFromParameterProvided} \`--from-...\` parameter(s) provided. 1 must be provided.`)
      }
      if (numberOfToParameterProvided !== 1) {
        errorMessages.push(`${numberOfToParameterProvided} \`--to-...\` parameter(s) provided. 1 must be provided.`)
      }
      return this.help(`${errorMessages.join('\n')}`)
    }

    let from: EngineArgs.MigrateDiffTarget
    if (args['--from-empty']) {
      from = {
        tag: 'empty',
      }
    } else if (args['--from-schema']) {
      const schema = await getSchemaWithPath({
        schemaPath: createSchemaPathInput({
          schemaPathFromArgs: path.resolve(args['--from-schema']),
          schemaPathFromConfig: config.schema,
          baseDir,
        }),
        argumentName: '--from-schema',
      })
      from = {
        tag: 'schemaDatamodel',
        ...toSchemasContainer(schema.schemas),
      }
    } else if (args['--from-migrations']) {
      from = {
        tag: 'migrations',
        ...(await listMigrations(args['--from-migrations'], config.migrations?.initShadowDb ?? '')),
      }
    } else if (args['--from-config-datasource']) {
      const schemaContext = await loadSchemaContext({
        schemaPath: createSchemaPathInput({ schemaPathFromConfig: config.schema, baseDir }),
        printLoadMessage: false,
      })
      from = {
        tag: 'schemaDatasource',
        ...toSchemasWithConfigDir(schemaContext, baseDir),
      }
    }

    let to: EngineArgs.MigrateDiffTarget
    if (args['--to-empty']) {
      to = {
        tag: 'empty',
      }
    } else if (args['--to-schema']) {
      const schema = await getSchemaWithPath({
        schemaPath: createSchemaPathInput({
          schemaPathFromArgs: path.resolve(args['--to-schema']),
          schemaPathFromConfig: config.schema,
          baseDir,
        }),
        argumentName: '--to-schema',
      })
      to = {
        tag: 'schemaDatamodel',
        ...toSchemasContainer(schema.schemas),
      }
    } else if (args['--to-migrations']) {
      to = {
        tag: 'migrations',
        ...(await listMigrations(args['--to-migrations'], config.migrations?.initShadowDb ?? '')),
      }
    } else if (args['--to-config-datasource']) {
      const schemaContext = await loadSchemaContext({
        schemaPath: createSchemaPathInput({ schemaPathFromConfig: config.schema, baseDir }),
        printLoadMessage: false,
      })
      to = {
        tag: 'schemaDatasource',
        ...toSchemasWithConfigDir(schemaContext, baseDir),
      }
    }

    const schemaFilter: MigrateTypes.SchemaFilter = {
      externalTables: config.tables?.external ?? [],
      externalEnums: config.enums?.external ?? [],
    }
    const migrate = await Migrate.setup({
      schemaEngineConfig: config,
      baseDir,
      schemaFilter,
      extensions: config['extensions'],
    })

    // Capture stdout if --output is defined
    const captureStdout = new CaptureStdout()
    const outputPath = args['--output']
    const isOutputDefined = Boolean(outputPath)
    if (isOutputDefined) {
      captureStdout.startCapture()
    }

    let result: EngineResults.MigrateDiffOutput
    try {
      result = await migrate.engine.migrateDiff({
        from: from!,
        to: to!,
        script: args['--script'] || false, // default is false
        exitCode: args['--exit-code'] ?? null,
        filters: {
          externalTables: config.tables?.external ?? [],
          externalEnums: config.enums?.external ?? [],
        },
      })
    } finally {
      // Stop engine
      await migrate.stop()
    }

    // Write output to file if --output is defined
    if (isOutputDefined) {
      captureStdout.stopCapture()
      const diffOutput = captureStdout.getCapturedText()
      captureStdout.clearCaptureText()
      await fs.writeAsync(outputPath!, diffOutput.join('\n'))
    }

    // Note: only contains the exitCode
    debug({ migrateDiffOutput: result })

    if (args['--exit-code'] && result.exitCode) {
      process.exit(result.exitCode)
    }

    // Return nothing
    // See below for where the printing to stdout happens
    // [console.info(result.params.content)](https://github.com/prisma/prisma/blob/e6d2bc01af44cec35cb2bda35a5c93e13dc4ba4e/packages/migrate/src/SchemaEngine.ts#L303)
    return ``
  }

  public help(error?: string): string | HelpError {
    if (error) {
      throw new HelpError(`\n${error}\n\n${renderHelpOptions(this.cliCommand)}`)
    }
    return renderHelp(this.cliCommand)
  }
}

export function getRemovedTargetParameterHint(parameter: string): string | undefined {
  switch (parameter) {
    case '--from-url':
    case '--to-url':
    case '--from-schema-datasource':
    case '--to-schema-datasource':
      return (
        `\`${parameter}\` was removed. Please use \`--[from/to]-config-datasource\` in ` +
        `combination with a Prisma config file that contains the appropriate datasource instead.`
      )
    case '--from-schema-datamodel':
    case '--to-schema-datamodel':
      return `\`${parameter}\` was removed. Please use \`--[from/to]-schema\` instead.`
    case '--from-local-d1':
    case '--to-local-d1':
      return (
        `\`${parameter}\` was removed. Please use \`--[from/to]-config-datasource\` in ` +
        `combination with a Prisma config file that contains the appropriate datasource instead. ` +
        `The \`@prisma/adapter-d1\` package exposes a \`listLocalDatabases()\` helper function ` +
        `to help you locate your local D1 databases. You can use the paths returned from that ` +
        `function to construct your datasource URL(s).`
      )
    default:
      return
  }
}
