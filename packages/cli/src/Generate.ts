import { createDefaultRegistry } from '@prisma/client-generator-registry'
import type { PrismaConfigInternal } from '@prisma/config'
import { enginesVersion } from '@prisma/engines'
import { SqlQueryOutput } from '@prisma/generator'
import {
  arg,
  BuiltInProvider,
  Command,
  createSchemaPathInput,
  format,
  Generator,
  getGenerators,
  getGeneratorSuccessMessage,
  getSchemaWithPath,
  HelpError,
  isError,
  logger,
  missingGeneratorMessage,
  parseEnvValue,
  type PrismaConfigWithDatasource,
  validatePrismaConfigWithDatasource,
} from '@prisma/internals'
import fs from 'fs'
import { bold, dim, green, red, yellow } from 'kleur/colors'
import logUpdate from 'log-update'
import path from 'path'
import resolvePkg from 'resolve-pkg'

import { processSchemaResult } from '../../internals/src/cli/schemaContext'
import { version as cliVersion } from '../package.json'
import { introspectSql, sqlDirPath } from './generate/introspectSql'
import { Watcher } from './generate/Watcher'
import { breakingChangesMessage } from './utils/breakingChanges'
import { type CliDistributionIdentity, getCliDistributionPackageName } from './utils/cli-distribution-identity'
import {
  getGlobalLocalVersionMismatchWarning as getDefaultGlobalLocalVersionMismatchWarning,
  type GlobalLocalVersionMismatchWarningOptions,
} from './utils/global-local-version-mismatch'
import { handleNpsSurvey } from './utils/nps/survey'
import { simpleDebounce } from './utils/simpleDebounce'
import { handleSkillsOffer } from './utils/skills/skills-offer'

type GenerateOptions = {
  getGlobalLocalVersionMismatchWarning?: (options: GlobalLocalVersionMismatchWarningOptions) => Promise<string | null>
  identity: CliDistributionIdentity
}

/**
 * $ prisma generate
 */
export class Generate implements Command {
  surveyHandler: () => Promise<void>
  skillsOfferHandler: () => Promise<{ prompted: boolean }>
  private readonly identity: CliDistributionIdentity
  private readonly getGlobalLocalVersionMismatchWarning: (
    options: GlobalLocalVersionMismatchWarningOptions,
  ) => Promise<string | null>

  constructor(
    surveyHandler: () => Promise<void> = handleNpsSurvey,
    skillsOfferHandler: () => Promise<{ prompted: boolean }> = handleSkillsOffer,
    options: GenerateOptions,
  ) {
    this.surveyHandler = surveyHandler
    this.skillsOfferHandler = skillsOfferHandler
    this.identity = options.identity
    this.getGlobalLocalVersionMismatchWarning =
      options.getGlobalLocalVersionMismatchWarning ?? getDefaultGlobalLocalVersionMismatchWarning
  }

  public static new(identity: CliDistributionIdentity): Generate {
    return new Generate(handleNpsSurvey, handleSkillsOffer, { identity })
  }

  private logText = ''
  private hasGeneratorErrored = false

  private runGenerate = simpleDebounce(
    async ({ generators, showHints }: { generators: Generator[]; showHints: boolean }) => {
      const messages: string[] = []
      const hints: string[] = []

      for (const generator of generators) {
        const before = Math.round(performance.now())
        try {
          await generator.generate()
          const after = Math.round(performance.now())
          messages.push(getGeneratorSuccessMessage(generator, after - before) + '\n')
          generator.stop()
        } catch (err) {
          this.hasGeneratorErrored = true
          generator.stop()
          const errorMessage = err instanceof Error ? err.message : String(err)
          messages.push(`${errorMessage}\n\n`)
        }
        hints.push(showHints && generator.usageHint ? `\n${generator.usageHint}\n` : '')
      }

      if (!this.hasGeneratorErrored) {
        for (let i = 0; i < messages.length; i++) {
          messages[i] += hints[i]
        }
      }

      this.logText += messages.join('\n')
    },
  )

  public async parse(
    argv: string[],
    config: PrismaConfigInternal,
    baseDir: string = process.cwd(),
  ): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--watch': Boolean,
      '--schema': String,
      '--config': String,
      '--no-hints': Boolean,
      '--generator': [String],
      '--telemetry-information': String,
      '--require-models': Boolean,
      '--sql': Boolean,
    })

    const allowNoModels = !args['--require-models']

    const cwd = process.cwd()
    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const watchMode = args['--watch'] || false
    const hideHints = args['--no-hints'] ?? false

    const schemaResult = await getSchemaWithPath({
      schemaPath: createSchemaPathInput({
        schemaPathFromArgs: args['--schema'],
        schemaPathFromConfig: config.schema,
        baseDir,
      }),
      cwd,
    })

    if (!schemaResult) return ''

    const schemaContext = await processSchemaResult({ schemaResult })

    // TODO Extract logic from here
    let hasJsClient = false
    let jsClient: Generator | undefined
    let generators: Generator[] | undefined
    let clientGeneratorVersion: string | null = null

    let typedSqlData: { validatedConfig: PrismaConfigWithDatasource; typedSql: SqlQueryOutput[] } | undefined
    if (args['--sql']) {
      const validatedConfig = validatePrismaConfigWithDatasource({ config, command: `${this.identity} generate --sql` })
      const typedSql = await introspectSql(validatedConfig, baseDir, schemaContext)
      typedSqlData = {
        validatedConfig,
        typedSql,
      }
    }

    try {
      generators = await getGenerators({
        schemaContext,
        printDownloadProgress: !watchMode,
        version: enginesVersion,
        generatorNames: args['--generator'],
        typedSql: typedSqlData?.typedSql,
        allowNoModels,
        registry: createDefaultRegistry(this.identity).toInternal(),
        cliCommand: this.identity,
      })

      if (!generators || generators.length === 0) {
        this.logText += `${missingGeneratorMessage(this.identity)}\n`
      } else {
        // Only used for the version-mismatch and breaking-changes warnings below
        jsClient = generators.find(
          (g) => g.options && parseEnvValue(g.options.generator.provider) === BuiltInProvider.PrismaClientJs,
        )

        clientGeneratorVersion = jsClient?.manifest?.version ?? null

        hasJsClient = Boolean(jsClient)

        try {
          await this.runGenerate({ generators, showHints: !hideHints && !watchMode })
        } catch (errRunGenerate) {
          this.logText += `${errRunGenerate.message}\n\n`
        }
      }
    } catch (errGetGenerators) {
      if (watchMode) {
        this.logText += `${errGetGenerators.message}\n\n`
      } else {
        throw errGetGenerators
      }
    }

    let printBreakingChangesMessage = false
    if (hasJsClient) {
      try {
        const clientVersionBeforeGenerate = getCurrentClientVersion()

        if (clientVersionBeforeGenerate && typeof clientVersionBeforeGenerate === 'string') {
          const [major, minor] = clientVersionBeforeGenerate.split('.')

          if (parseInt(major) == 2 && parseInt(minor) < 12) {
            printBreakingChangesMessage = true
          }
        }
      } catch (e) {
        //
      }
    }

    if (printBreakingChangesMessage && logger.should.warn()) {
      // skipping generate
      return `There have been breaking changes in Prisma Client since you updated last time.
Please run \`${this.identity} generate\` manually.`
    }

    const watchingText = `\n${green('Watching...')} ${dim(schemaContext.schemaRootDir)}\n`

    if (!watchMode) {
      let globalLocalVersionWarning: string | null = null
      if (logger.should.warn()) {
        try {
          globalLocalVersionWarning = await this.getGlobalLocalVersionMismatchWarning({
            cwd: schemaContext.schemaRootDir,
            globalVersion: cliVersion,
            identity: this.identity,
          })
        } catch {
          globalLocalVersionWarning = null
        }
      }
      const globalLocalVersionWarningStr = globalLocalVersionWarning ? `\n\n${globalLocalVersionWarning}` : ''

      let globalWarnings = ''
      if (jsClient) {
        const breakingChangesStr =
          printBreakingChangesMessage && logger.should.warn() ? `\n\n${breakingChangesMessage}` : ''

        const versionsOutOfSync = clientGeneratorVersion && cliVersion !== clientGeneratorVersion
        const versionsWarning =
          versionsOutOfSync && logger.should.warn()
            ? `\n\n${yellow(bold('warn'))} Versions of ${bold(
                `${getCliDistributionPackageName(this.identity)}@${cliVersion}`,
              )} and ${bold(`@prisma/client@${clientGeneratorVersion}`)} don't match.
This might lead to unexpected behavior.
Please make sure they have the same version.`
            : ''

        globalWarnings = `${breakingChangesStr}${versionsWarning}`
      }

      globalWarnings += globalLocalVersionWarningStr

      const shouldAppendWarnings = hasJsClient || Boolean(globalLocalVersionWarningStr)
      const message = '\n' + this.logText + (shouldAppendWarnings && !this.hasGeneratorErrored ? globalWarnings : '')

      if (this.hasGeneratorErrored) {
        throw new Error(message)
      } else {
        if (!hideHints) {
          // at most one prompt per generate run: the offer preempts the survey
          const { prompted } = await this.skillsOfferHandler()
          if (!prompted) {
            await this.surveyHandler()
          }
        }

        return message
      }
    } else {
      logUpdate(watchingText + '\n' + this.logText)

      const watcher = new Watcher(schemaContext.schemaRootDir)
      if (args['--sql']) {
        watcher.add(sqlDirPath(schemaContext.schemaRootDir))
      }

      for await (const changedPath of watcher) {
        logUpdate(`Change in ${path.relative(process.cwd(), changedPath)}`)

        const schemaResult = await getSchemaWithPath({
          schemaPath: createSchemaPathInput({
            schemaPathFromArgs: args['--schema'],
            schemaPathFromConfig: config.schema,
            baseDir,
          }),
          cwd,
        })
        if (!schemaResult) return ''

        const schemaContext = await processSchemaResult({ schemaResult })

        let generatorsWatch: Generator[] | undefined
        try {
          if (typedSqlData !== undefined) {
            typedSqlData.typedSql = await introspectSql(typedSqlData.validatedConfig, baseDir, schemaContext)
          }

          generatorsWatch = await getGenerators({
            schemaContext,
            printDownloadProgress: !watchMode,
            version: enginesVersion,
            generatorNames: args['--generator'],
            typedSql: typedSqlData?.typedSql,
            registry: createDefaultRegistry(this.identity).toInternal(),
            cliCommand: this.identity,
          })

          if (!generatorsWatch || generatorsWatch.length === 0) {
            this.logText += `${missingGeneratorMessage(this.identity)}\n`
          } else {
            logUpdate(`\n${green('Building...')}\n\n${this.logText}`)
            try {
              await this.runGenerate({
                generators: generatorsWatch,
                showHints: false,
              })
              logUpdate(watchingText + '\n' + this.logText)
            } catch (errRunGenerate) {
              this.logText += `${errRunGenerate.message}\n\n`
              logUpdate(watchingText + '\n' + this.logText)
            }
          }
        } catch (errGetGenerators) {
          this.logText += `${errGetGenerators.message}\n\n`
          logUpdate(watchingText + '\n' + this.logText)
        }
      }
    }

    return ''
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
Generate artifacts (e.g. Prisma Client)

${bold('Usage')}

  ${dim('$')} ${identity} generate [options]

${bold('Options')}
          -h, --help   Display this help message
            --config   Custom path to your Prisma config file
            --schema   Custom path to your Prisma schema
               --sql   Generate typed sql module
             --watch   Watch the Prisma schema and rerun after a change
         --generator   Generator to use (may be provided multiple times)
          --no-hints   Hides the hint messages but still outputs errors and warnings
    --require-models   Do not allow generating a client without models

${bold('Examples')}

  With an existing Prisma schema
    ${dim('$')} ${identity} generate

  Or specify a schema
    ${dim('$')} ${identity} generate --schema=./schema.prisma

  Run the command with multiple specific generators
    ${dim('$')} ${identity} generate --generator client1 --generator client2

  Watch Prisma schema file and rerun after each change
    ${dim('$')} ${identity} generate --watch

`)
}

function getCurrentClientVersion(): string | null {
  try {
    let pkgPath = resolvePkg('.prisma/client', { cwd: process.cwd() })
    if (!pkgPath) {
      const potentialPkgPath = path.join(process.cwd(), 'node_modules/.prisma/client')
      if (fs.existsSync(potentialPkgPath)) {
        pkgPath = potentialPkgPath
      }
    }
    if (pkgPath) {
      const indexPath = path.join(pkgPath, 'index.js')
      if (fs.existsSync(indexPath)) {
        const program = require(indexPath)
        return program?.prismaVersion?.client ?? program?.Prisma?.prismaVersion?.client
      }
    }
  } catch (e) {
    return null
  }

  return null
}
