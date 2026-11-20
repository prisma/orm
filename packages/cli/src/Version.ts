import path from 'node:path'

import type { PrismaConfigInternal } from '@prisma/config'
import { enginesVersion } from '@prisma/engines'
import {
  arg,
  BinaryType,
  Command,
  createSchemaPathInput,
  format,
  formatTable,
  getEnginesInfo,
  getTypescriptVersion,
  HelpError,
  isError,
  loadSchemaContext,
  resolveEngine,
  wasm,
} from '@prisma/internals'
import { bold, dim, red } from 'kleur/colors'
import os from 'os'

import type { CliDistributionIdentity } from './utils/cli-distribution-identity'
import { getInstalledPrismaClientVersion } from './utils/getClientVersion'

const packageJson = require('../package.json')

/**
 * $ prisma version
 */
export class Version implements Command {
  static new(identity: CliDistributionIdentity): Version {
    return new Version(identity)
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
      '--version': Boolean,
      '-v': '--version',
      '--config': String,
      '--json': Boolean,
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const engineResult = await resolveEngine(BinaryType.SchemaEngineBinary)
    const [enginesInfo, schemaEngineRetrievalErrors] = getEnginesInfo(engineResult)

    const schemaEngineRows = [['Schema Engine', enginesInfo] as const]

    const prismaClientVersion = await getInstalledPrismaClientVersion()
    const typescriptVersion = await getTypescriptVersion()
    const prismaCliPath = path.dirname(require.resolve('../package.json'))

    const rows = [
      [this.identity, packageJson.version],
      ['@prisma/client', prismaClientVersion ?? 'Not found'],
      ['Operating System', os.platform()],
      ['Architecture', os.arch()],
      ['Node.js', process.version],
      ['TypeScript', typescriptVersion],
      ['Query Compiler', 'enabled'],
      ['PSL', `@prisma/prisma-schema-wasm ${wasm.prismaSchemaWasmVersion}`],
      ...schemaEngineRows,

      ['Default Engines Hash', enginesVersion],
      ['Studio', packageJson.dependencies['@prisma/studio-core']],
      ['Prisma CLI Path', prismaCliPath],
    ]

    /**
     * If reading Rust engines metainfo (like their git hash) failed, display the errors to stderr,
     * and let Node.js exit naturally, but with error code 1.
     */

    if (schemaEngineRetrievalErrors.length > 0) {
      process.exitCode = 1
      schemaEngineRetrievalErrors.forEach((e) => console.error(e))
    }

    const featureFlags = await this.getFeatureFlags(config.schema, baseDir)
    if (featureFlags && featureFlags.length > 0) {
      rows.push(['Preview Features', featureFlags.join(', ')])
    }

    // @ts-ignore TODO @jkomyno, as affects the type of rows
    return formatTable(rows, { json: args['--json'] })
  }

  private async getFeatureFlags(schemaPath: string | undefined, baseDir: string): Promise<string[]> {
    try {
      const { generators } = await loadSchemaContext({
        schemaPath: createSchemaPathInput({ schemaPathFromConfig: schemaPath, baseDir }),
      })
      const generator = generators.find((g) => g.previewFeatures.length > 0)
      if (generator) {
        return generator.previewFeatures
      }
    } catch (e) {
      // console.error(e)
    }
    return []
  }
}

function createHelp(identity: CliDistributionIdentity): string {
  return format(`
  Print current version of Prisma components

  ${bold('Usage')}

    ${dim('$')} ${identity} -v [options]
    ${dim('$')} ${identity} version [options]

  ${bold('Options')}

    -h, --help     Display this help message
        --json     Output JSON
`)
}
