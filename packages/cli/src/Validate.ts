import path from 'node:path'

import type { PrismaConfigInternal } from '@prisma/config'
import {
  arg,
  Command,
  createSchemaPathInput,
  format,
  getConfig,
  getLintWarningsAsText,
  getSchemaWithPath,
  handleLintPanic,
  HelpError,
  lintSchema,
  logger,
  printSchemaLoadedMessage,
  validate,
} from '@prisma/internals'
import { bold, dim, red, underline } from 'kleur/colors'

import type { CliDistributionIdentity } from './utils/cli-distribution-identity'

/**
 * $ prisma validate
 */
export class Validate implements Command {
  public static new(identity: CliDistributionIdentity): Validate {
    return new Validate(identity)
  }

  constructor(private readonly identity: CliDistributionIdentity) {}

  public async parse(
    argv: string[],
    config: PrismaConfigInternal,
    baseDir: string = process.cwd(),
  ): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--schema': String,
      '--config': String,
      '--telemetry-information': String,
    })

    if (args instanceof Error) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const { schemaPath, schemas } = await getSchemaWithPath({
      schemaPath: createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
    })
    printSchemaLoadedMessage(schemaPath)

    const { lintDiagnostics } = handleLintPanic(() => {
      // the only possible error here is a Rust panic
      const lintDiagnostics = lintSchema({ schemas })
      return { lintDiagnostics }
    })

    const lintWarnings = getLintWarningsAsText(lintDiagnostics)
    if (lintWarnings && logger.should.warn()) {
      // Output warnings to stderr
      console.warn(lintWarnings)
    }

    validate({
      schemas,
    })

    await getConfig({
      datamodel: schemas,
    })

    const schemaRelativePath = path.relative(process.cwd(), schemaPath)

    if (schemas.length > 1) {
      return `The schemas at ${underline(schemaRelativePath)} are valid 🚀`
    }

    return `The schema at ${underline(schemaRelativePath)} is valid 🚀`
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
Validate a Prisma schema.

${bold('Usage')}

  ${dim('$')} ${identity} validate [options]

${bold('Options')}

  -h, --help   Display this help message
    --config   Custom path to your Prisma config file
    --schema   Custom path to your Prisma schema

${bold('Examples')}

  With an existing Prisma schema
    ${dim('$')} ${identity} validate

  With a Prisma config file
    ${dim('$')} ${identity} validate --config=./prisma7.config.ts

  Or specify a Prisma schema path
    ${dim('$')} ${identity} validate --schema=./schema.prisma

`)
}
