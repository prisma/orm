import { PrismaConfigInternal } from '@prisma/config'
import {
  arg,
  Command,
  createSchemaPathInput,
  getCLIPathHash,
  getProjectHash,
  HelpError,
  isError,
} from '@prisma/internals'
import * as checkpoint from 'checkpoint-client'

/**
 * $ prisma telemetry
 */
export class Telemetry implements Command {
  public static new(): Telemetry {
    return new Telemetry()
  }

  // parse arguments
  public async parse(
    argv: string[],
    config: PrismaConfigInternal,
    baseDir: string = process.cwd(),
  ): Promise<string | Error> {
    const args = arg(argv, {
      '--schema': String,
    })

    if (isError(args)) {
      throw new HelpError(`Invalid arguments supplied`)
    }

    const info = await checkpoint.getInfo()
    // SHA256 identifier for the project based on the Prisma schema path
    const projectPathHash = getProjectHash(
      createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
    )
    // SHA256 of the cli path
    const cliPathHash = getCLIPathHash()

    const cacheItems = info.cacheItems.map((it) => {
      return {
        product: it.output.product,
        version: it.version,
        package: it.output.package,
        release_tag: it.output.release_tag,
        cli_path: it.cli_path,
        cli_path_hash: it.output.cli_path_hash,
        last_reminder: it.last_reminder,
        cached_at: it.cached_at,
      }
    })

    return JSON.stringify(
      {
        signature: info.signature,
        cachePath: info.cachePath,
        current: {
          projectPathHash,
          cliPathHash,
        },
        cacheItems,
      },
      undefined,
      2,
    )
  }
}
