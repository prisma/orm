import type { PrismaConfigInternal } from '@prisma/config'
import type { Command } from '@prisma/internals'
import {
  arg,
  createSchemaPathInput,
  format,
  getSchemaWithPath,
  HelpError,
  isCi,
  isError,
  isInteractive,
  link,
} from '@prisma/internals'
import { bold, dim, red, underline } from 'kleur/colors'

import { getRootCacheDir } from '../../fetch-engine/src/utils'
import type { CliDistributionIdentity } from './utils/cli-distribution-identity'

/**
 * $ prisma debug
 */
export class DebugInfo implements Command {
  static new(identity: CliDistributionIdentity): DebugInfo {
    return new DebugInfo(identity)
  }

  constructor(private readonly identity: CliDistributionIdentity) {}

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${createHelp(this.identity)}`)
    }

    return createHelp(this.identity)
  }

  async parse(argv: string[], config: PrismaConfigInternal, baseDir: string = process.cwd()): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--schema': String,
      '--config': String,
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const formatEnvValue = (name: string, text?: string) => {
      const value = process.env[name]
      const line = `- ${name}${text ? ` ${text}` : ''}`

      if (value === undefined) {
        return dim(line + ':')
      }
      return bold(line + `: \`${value}\``)
    }

    let schemaPath
    try {
      const schemaResult = await getSchemaWithPath({
        schemaPath: createSchemaPathInput({
          schemaPathFromArgs: args['--schema'],
          schemaPathFromConfig: config.schema,
          baseDir,
        }),
      })
      schemaPath = link(schemaResult.schemaPath)
    } catch (e) {
      schemaPath = e.message
    }
    const rootCacheDir = link(await getRootCacheDir())

    return `${underline('-- Prisma schema --')}
Path: ${schemaPath}

${underline('-- Local cache directory for engines files --')}
Path: ${rootCacheDir}

${underline('-- Environment variables --')}
When not set, the line is dimmed and no value is displayed.
When set, the line is bold and the value is inside the \`\` backticks.

For general debugging
${formatEnvValue('CI')}
${formatEnvValue('DEBUG')}
${formatEnvValue('NODE_ENV')}
${formatEnvValue('RUST_LOG')}
${formatEnvValue('RUST_BACKTRACE')}
${formatEnvValue('NO_COLOR')}
${formatEnvValue('TERM')}
${formatEnvValue('NODE_TLS_REJECT_UNAUTHORIZED')}
${formatEnvValue('NO_PROXY')}
${formatEnvValue('http_proxy')}
${formatEnvValue('HTTP_PROXY')}
${formatEnvValue('https_proxy')}
${formatEnvValue('HTTPS_PROXY')}

For more information about Prisma environment variables:
See ${link('https://pris.ly/d/env-vars')}

For hiding messages
${formatEnvValue('PRISMA_DISABLE_WARNINGS')}
${formatEnvValue('PRISMA_HIDE_PREVIEW_FLAG_WARNINGS')}
${formatEnvValue('PRISMA_HIDE_UPDATE_MESSAGE')}

For downloading engines
${formatEnvValue('PRISMA_ENGINES_MIRROR')}
${formatEnvValue('PRISMA_BINARIES_MIRROR', '(deprecated)')}
${formatEnvValue('PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING')}
${formatEnvValue('BINARY_DOWNLOAD_VERSION')}

For custom engines
${formatEnvValue('PRISMA_SCHEMA_ENGINE_BINARY')}
${formatEnvValue('PRISMA_MIGRATION_ENGINE_BINARY')}

For Prisma Client
${formatEnvValue('PRISMA_SHOW_ALL_TRACES')}

For Prisma Migrate
${formatEnvValue('PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK')}

For Prisma Studio
${formatEnvValue('BROWSER')}

${underline('-- Terminal is interactive? --')}
${isInteractive()}

${underline('-- CI detected? --')}
${isCi()}
`
  }
}

function createHelp(identity: CliDistributionIdentity): string {
  return format(`
  Print information helpful for debugging and bug reports

  ${bold('Usage')}

    ${dim('$')} ${identity} debug [options]

  ${bold('Options')}

    -h, --help     Display this help message
    --config       Custom path to your Prisma config file
    --schema       Custom path to your Prisma schema
`)
}
