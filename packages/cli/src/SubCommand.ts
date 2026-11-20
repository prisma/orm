import { existsSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PrismaConfigInternal } from '@prisma/config'
import Debug from '@prisma/debug'
import type { Command } from '@prisma/internals'
import * as execa from 'execa'
import { dim, underline } from 'kleur/colors'

import type { CliDistributionIdentity } from './utils/cli-distribution-identity'
import { printError } from './utils/prompt/utils/print'

const packageJson = require('../package.json')

const debug = Debug('prisma:cli:subcommand')

/**
 * Additional context that is passed to the subcommand.
 */
type RunnableContext = {
  /**
   * Version of the CLI that is running the subcommand. Can be used to check for breaking changes etc..
   */
  cliVersion: string
}

/**
 * Sub-CLIs that are installed on demand need to implement this interface
 */
type Runnable = {
  run: (args: string[], config: PrismaConfigInternal, context: RunnableContext) => Promise<void>
}

class NpmInstallError extends Error {
  constructor(readonly reason: unknown) {
    super('Failed to install subcommand package via npm')
  }
}

class ImportError extends Error {
  constructor(readonly reason: unknown) {
    super('Failed to import subcommand package')
  }
}

class DenoNotSupportedError extends Error {
  constructor() {
    super('Deno is an unsupported CLI runtime for this subcommand')
  }
}

/**
 * Generic SubCommand that installs a package on demand and runs it
 */
export class SubCommand implements Command {
  pkg: string

  constructor(
    pkg: string,
    private readonly identity: CliDistributionIdentity,
  ) {
    this.pkg = pkg
  }

  async parse(argv: string[], config: PrismaConfigInternal): Promise<string | Error> {
    try {
      this.checkForDeno()

      // we accept forcing a version with @, eg. prisma rules @1.0.0 --help
      const [version, ...args] = argv[0]?.startsWith('@') ? argv : ['@latest', ...argv]

      const context: RunnableContext = {
        cliVersion: packageJson.version,
      }

      // load the module and run it via the Runnable interface
      const module = await this.importPackage(this.pkg, version)
      await module.run(args, config, context)
    } catch (e) {
      this.handleError(e)
    }
    return ''
  }

  public help() {}

  private checkForDeno() {
    if (typeof globalThis.Deno !== 'undefined' && typeof globalThis.Deno.version !== 'undefined')
      throw new DenoNotSupportedError()
  }

  private async importPackage(pkg: string, version: string): Promise<Runnable> {
    const pkgWithVersion = `${pkg}${version}`

    // when version defaults to @latest, we cache it for the current day only
    const dayMillis = new Date().setHours(0, 0, 0, 0)
    const cacheKey = version === '@latest' ? `-${dayMillis}` : ''
    const prefix = `${tmpdir()}/${pkgWithVersion}${cacheKey}`

    debug(`using cache directory: ${prefix}`)

    const modulePath = await this.installPackage(pkgWithVersion, prefix)

    debug(`using module path: ${modulePath}`)
    try {
      return await import(modulePath)
    } catch (e) {
      debug(`import failed: ${e}`)
      debug(`=> wiping cache and retrying`)
      return this.wipeCacheAndRetry(pkgWithVersion, prefix)
    }
  }

  private async wipeCacheAndRetry(pkgWithVersion: string, prefix: string): Promise<Runnable> {
    // Wipe cache and retry if import fails
    rmSync(prefix, { recursive: true })
    const modulePath = await this.installPackage(pkgWithVersion, prefix)
    try {
      return await import(modulePath)
    } catch (e) {
      throw new ImportError(e)
    }
  }

  private async installPackage(pkgWithVersion: string, prefix: string) {
    const npmCachedModulePath = pathToFileURL(join(prefix, 'node_modules', this.pkg, 'dist', 'index.js')).toString()
    if (existsSync(prefix)) return npmCachedModulePath

    process.stdout.write(dim(`Fetching latest updates for this subcommand...\n`))

    const installCmdArgs = [
      'install',
      pkgWithVersion,
      '--no-save',
      '--prefix',
      prefix,
      '--userconfig',
      prefix,
      '--loglevel',
      'error',
    ]
    debug(`running install cmd: npm ${installCmdArgs.join(' ')}`)

    try {
      // Ensure the prefix directory exists
      await fs.mkdir(prefix, { recursive: true })
      // Note: Using execa this way ensure proper argument encoding for whitespaces
      await execa.default('npm', installCmdArgs, {
        stdout: 'ignore',
        stderr: 'inherit',
        cwd: prefix,
        env: process.env,
      })
      return npmCachedModulePath
    } catch (e: unknown) {
      debug(`install via npm failed: ${e}`)
      throw new NpmInstallError(e)
    }
  }

  private handleError(error: unknown) {
    process.exitCode = 1
    if (error instanceof ImportError) {
      console.log(`\n${printError('Failed to import this dynamic subcommand.')}`)
      console.log(dim(`\n${underline('Underlying Error:')}\n${error.reason}`))
    } else if (error instanceof NpmInstallError) {
      console.log(
        `\n${printError(`Failed to install dynamic subcommand via npm.
        This subcommand is dynamically loaded and therefore requires npm to be installed.
        Please install npm and rerun this command.`)}`,
      )
      console.log(dim(`\n${underline('Underlying Error:')}\n${error.reason}`))
    } else if (error instanceof DenoNotSupportedError) {
      console.log(
        `\n${printError(`This subcommand is not supported in Deno.
        Please use Node.js to run this command.
        E.g. via 'npx ${this.identity} <cmd>'.`)}`,
      )
      console.log(`
Note: You can still use Prisma's generated code via the 'prisma-client' generator on Deno.
See https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-deno-deploy for more information.`)
    } else {
      console.log(`\n${printError(`Failed to run subcommand.`)}`)
      console.log(dim(`\n${underline('Underlying Error:')}\n${error}`))
    }
  }
}
